/**
 * Reading and writing person notes: filling their properties, papers and
 * collaborators, creating new ones (also by clicking a collaborator's name),
 * saving photos, and rebuilding the research feed.
 */
import { type App, getAllTags, getFrontMatterInfo, normalizePath, parseYaml, TFile, Vault } from 'obsidian';
import { eventsSelector, peopleSelector, type ScholarAtlasSettings } from './settings.ts';
import { matches, type NoteSelector } from './selector.ts';
import { NetworkError, RequestError, type SourceOptions, Sources } from './sources.ts';
import {
	addToList, affiliations, isEmpty, keepOldPlaces, lastPart, matchOpenAlex, matchOrcid, orcidWorks, profileChanges, rawProfile,
} from './profile.ts';
import {
	blockPapers, END, feedWithSection, getBlock, getSection, isCandidateList, NOT_ON_OPENALEX, renderCandidates, renderFeed, renderWorks,
	setBlock, setSection, START, unknownAuthor, worksSummary,
} from './papers.ts';
import {
	type Collaborator, CONNECTIONS_END, CONNECTIONS_START, type ConnectionLinks, connections, pendingTargets,
	renderConnections,
} from './connections.ts';
import { Places, safeName } from './places.ts';
import { availablePath, ensureFolder } from './folders.ts';
import { researchTags } from './tagging.ts';
import { withCard } from './photo.ts';
import type { PhotoImage } from './photo-picker.ts';
import { shrinkPhoto } from './shrink-photo.ts';
import type { Author, Frontmatter, Profile } from './types.ts';

const DEFAULT_TEMPLATE = `---
photo:
events: []
city:
country:
institutions: []
previous_institutions: []
lab:
methods: []
model_systems: []
orcid:
openalex:
website:
email:
linkedin:
only_update_papers: false
---
## Notes


## Papers
${START}
${END}

## Collaborators
${CONNECTIONS_START}
${CONNECTIONS_END}
`;

/** How many people are updated at once. Requests are also paced per service (see sources.ts). */
const CONCURRENCY = 8;

/** How thoroughly to update a person. */
interface UpdateMode {
	/** Overwrite city, country and both institution lists with what's found. */
	refresh: boolean;
	/** Look everything up again, rather than skipping what can't have changed. */
	full: boolean;
	/** This one person was asked for, so `only_update_papers` doesn't apply. */
	single: boolean;
}

/** Checkbox property: only keep this person's papers up to date when updating everyone. */
export const PAPERS_ONLY = 'only_update_papers';

function papersOnly(fm: Frontmatter): boolean {
	const v = fm[PAPERS_ONLY];
	return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

export interface PeopleDeps {
	apiKey: () => string;
	/** Persist settings, including the ORCID check times. */
	save?: () => Promise<void>;
	/** Overrides for the network layer (tests). */
	sources?: Partial<SourceOptions>;
}

export interface NewPerson {
	name: string;
	orcid: string;
	openalex: string;
	/** Name of the event note where you met; empty for none. */
	event: string;
	photo: PhotoImage | null;
}

/** The IDs in a person note, as far as they can be read without any lookups. */
interface NoteIds {
	notOnOpenAlex: boolean;
	openalex: string;
	orcid: string;
}

function readIds(fm: Frontmatter): NoteIds {
	const notOnOpenAlex = typeof fm.openalex === 'string' && fm.openalex.trim().toLowerCase() === 'none';
	return { notOnOpenAlex, openalex: notOnOpenAlex ? '' : matchOpenAlex(fm.openalex), orcid: matchOrcid(fm.orcid) };
}

function frontmatterOf(text: string): Frontmatter | null {
	const info = getFrontMatterInfo(text);
	return info.exists ? ((parseYaml(info.frontmatter) ?? {}) as Frontmatter) : null;
}

export class People {
	private readonly app: App;
	private readonly settings: ScholarAtlasSettings;
	private readonly deps: PeopleDeps;
	readonly places: Places;
	/**
	 * What each person note holds as of its last modification: its dated papers
	 * (for the feed) and the not-yet-created notes its collaborators block links
	 * to (for click-to-create). Only notes that changed are read again.
	 */
	private readonly scans = new Map<string, { mtime: number; papers: [string, string][]; pending: Map<string, string> }>();
	/** OpenAlex ID -> person note, for linking collaborators who already have one. */
	private byId: Map<string, TFile> | null = null;
	/** The feed as last written, so it isn't read back just to see it's unchanged. */
	private feedWritten: { path: string; mtime: number; content: string } | null = null;

	constructor(app: App, settings: ScholarAtlasSettings, deps: PeopleDeps) {
		this.app = app;
		this.settings = settings;
		this.deps = deps;
		this.places = new Places(app, settings);
	}

	/** Where new people are created: the people folder, else where Obsidian puts new notes. */
	private get newPeopleFolder(): string {
		const folder = normalizePath(this.settings.peopleFolder.trim());
		if (folder && folder !== '/') return folder;
		const parent = this.app.fileManager.getNewFileParent('').path;
		return parent === '/' ? '' : parent;
	}

	private tagsOf(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		return cache ? getAllTags(cache) ?? [] : [];
	}

	/** Notes matching a selector: just the folder's when that's enough, else a scan of the vault's notes. */
	private select(sel: NoteSelector): TFile[] {
		const files = sel.folder && (!sel.tags.length || sel.match === 'all') ? this.notesIn(sel.folder) : this.app.vault.getMarkdownFiles();
		return files.filter((f) => matches(sel, f.path, this.tagsOf(f)));
	}

	sources(): Sources {
		return new Sources({
			mailto: this.settings.mailto,
			apiKey: this.deps.apiKey(),
			papersPerPerson: this.settings.papersPerPerson,
			...this.deps.sources,
		});
	}

	/** Whether a note is a person: in the people folder and/or tagged as set in the settings. */
	isPerson(file: TFile): boolean {
		return file.extension === 'md' && matches(peopleSelector(this.settings), file.path, this.tagsOf(file));
	}

	/** Every person note, by name. */
	list(): TFile[] {
		return this.select(peopleSelector(this.settings)).sort((a, b) => a.basename.localeCompare(b.basename));
	}

	/** Person notes by OpenAlex ID, from the properties Obsidian keeps in memory. */
	private peopleById(): Map<string, TFile> {
		if (!this.byId) {
			this.byId = new Map();
			for (const f of this.list()) {
				const id = matchOpenAlex(this.app.metadataCache.getFileCache(f)?.frontmatter?.openalex);
				if (id) this.byId.set(id, f);
			}
		}
		return this.byId;
	}

	/** A link to a person: their note if they have one, else a path in the people folder so clicking creates it. */
	private personLink(c: Collaborator, sourcePath: string): string {
		const file = this.peopleById().get(c.id);
		if (file) return `[[${this.app.metadataCache.fileToLinktext(file, sourcePath)}]]`;
		const folder = this.newPeopleFolder;
		return `[[${folder ? `${folder}/` : ''}${safeName(c.name)}|${c.name}]]`;
	}

	private connectionLinks(sourcePath: string): ConnectionLinks {
		return {
			person: (c) => this.personLink(c, sourcePath),
			institution: (p) => this.places.institutionLink({ name: p.name, id: p.id }),
			country: (code) => this.places.countryLink(code),
		};
	}

	/** Event notes for the "Met at" suggestions, most recently changed first. */
	events(): TFile[] {
		return this.select(eventsSelector(this.settings)).sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	/** Give a new person note the first people tag, so it counts as a person when people are chosen by tag. */
	private async tagAsPerson(file: TFile): Promise<void> {
		const tag = peopleSelector(this.settings).tags[0];
		if (!tag || this.isPerson(file)) return;
		await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			const tags: unknown[] = Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === 'string' && fm.tags ? [fm.tags] : [];
			if (!tags.includes(tag)) tags.push(tag);
			fm.tags = tags;
		});
	}

	private notesIn(folder: string): TFile[] {
		const root = this.app.vault.getFolderByPath(folder);
		if (!root) return [];
		const files: TFile[] = [];
		Vault.recurseChildren(root, (f) => {
			if (f instanceof TFile && f.extension === 'md') files.push(f);
		});
		return files;
	}

	/** Create a person note from the template, fill it in and open it. */
	async add({ name, orcid, openalex, event, photo }: NewPerson): Promise<string> {
		const { vault, workspace, fileManager, metadataCache } = this.app;
		const folder = this.newPeopleFolder;
		const path = normalizePath(`${folder ? `${folder}/` : ''}${name}.md`);
		const existing = vault.getFileByPath(path) ?? this.list().find((f) => f.basename.toLowerCase() === name.toLowerCase());
		if (existing) {
			await workspace.getLeaf(false).openFile(existing);
			return `${name} already has a note; opened it.`;
		}
		if (folder) await ensureFolder(this.app, folder);
		const template = vault.getFileByPath(normalizePath(this.settings.templateFile));
		const file = await vault.create(path, template ? await vault.read(template) : DEFAULT_TEMPLATE);
		event = event.replace(/^\[\[|\]\]$/g, '').trim();
		if (orcid || openalex || event) {
			const eventFile = event ? this.events().find((f) => f.basename.toLowerCase() === event.toLowerCase()) : null;
			const eventLink = eventFile ? `[[${metadataCache.fileToLinktext(eventFile, file.path)}]]` : `[[${event}]]`;
			await fileManager.processFrontMatter(file, (fm: Frontmatter) => {
				if (orcid) fm.orcid = orcid;
				if (openalex) fm.openalex = openalex;
				if (event) {
					const events: unknown[] = Array.isArray(fm.events) ? fm.events : fm.events ? [fm.events] : [];
					if (!events.includes(eventLink)) events.push(eventLink);
					fm.events = events;
				}
			});
		}
		await this.tagAsPerson(file);
		if (photo) await this.setPhoto(file, photo);
		await workspace.getLeaf(false).openFile(file);
		return this.updateOne(file);
	}

	/** Update one person, looking everything up again. */
	async updateOne(file: TFile): Promise<string> {
		const status = await this.update(file, { refresh: false, full: true, single: true }, this.sources());
		await this.deps.save?.();
		await this.writeFeed();
		return status;
	}

	/**
	 * Update every person, several at a time, after fetching everyone's OpenAlex
	 * records in batches. Unless refreshing, what can't have changed is skipped,
	 * so repeat runs stay quick as the network grows. Stops early if a service
	 * can't be reached.
	 */
	async updateAll(refresh: boolean, progress: (message: string) => void): Promise<string> {
		const files = this.list();
		const src = this.sources();
		const mode: UpdateMode = { refresh, full: refresh, single: false };
		this.byId = null;
		this.places.reset();

		progress('Looking people up on OpenAlex…');
		// Obsidian already has every note's properties in memory; only read files it hasn't indexed.
		const ids = await Promise.all(files.map(async (f) => {
			const fm = (this.app.metadataCache.getFileCache(f)?.frontmatter)
				?? frontmatterOf(await this.app.vault.cachedRead(f));
			return fm ? readIds(fm) : null;
		}));
		const openAlexIds = ids.flatMap((i) => (i?.openalex ? [i.openalex] : []));
		const orcids = ids.flatMap((i) => (i && !i.openalex && !i.notOnOpenAlex && i.orcid ? [i.orcid] : []));
		await src.prefetch(openAlexIds, orcids);
		// Details for every institution that doesn't have a note yet, in batches too.
		const authors: Author[] = await Promise.all([
			...openAlexIds.map((id) => src.author(id)),
			...orcids.map(async (o) => { const id = await src.authorFromOrcid(o); return id ? src.author(id) : {}; }),
		]);
		const institutionIds = authors.flatMap((a) => [
			...(a.last_known_institutions ?? []), ...affiliations(a).flatMap((x) => (x.institution ? [x.institution] : [])),
		]).map((i) => lastPart(i.id));
		await src.institutions(this.places.missing(institutionIds));
		// Know everyone's OpenAlex ID up front, including those only resolved from their ORCID just now,
		// so collaborators link to their notes.
		this.byId = new Map();
		for (const [i, file] of files.entries()) {
			const note = ids[i];
			const id = note?.openalex || (note?.orcid && !note.notOnOpenAlex ? await src.authorFromOrcid(note.orcid) : '');
			if (id) this.byId.set(id, file);
		}

		const failed: string[] = [];
		const seen = new Set<string>();
		let done = 0;
		const run: { stop: Error | null } = { stop: null };
		await eachLimit(files, CONCURRENCY, () => run.stop !== null, async (file) => {
			try {
				await this.update(file, mode, src, seen);
			} catch (e) {
				if (e instanceof NetworkError || e instanceof RequestError) {
					run.stop ??= e;
					return;
				}
				console.error(`Scholar Atlas: couldn't update ${file.basename}`, e);
				failed.push(file.basename);
			}
			done++;
			progress(`Updating people ${done}/${files.length}`);
		});

		if (!run.stop) this.forgetOrcidChecks(seen);
		await this.deps.save?.();
		const papers = await this.writeFeed();
		const updated = done - failed.length;
		let result = run.stop
			? `Stopped after updating ${updated} of ${files.length} people. ${run.stop.message}`
			: `Updated ${updated} people; the research feed has ${papers} recent papers.`;
		if (failed.length) result += ` Failed: ${failed.join(', ')} (details in the developer console).`;
		return result;
	}

	/**
	 * Fill one person's empty properties and papers block; return a one-line
	 * status. ORCIDs looked at are added to `seen`.
	 */
	async update(file: TFile, mode: UpdateMode, src: Sources, seen?: Set<string>): Promise<string> {
		const { vault, fileManager } = this.app;
		const name = file.basename;
		const text = await vault.read(file);
		const fm = frontmatterOf(text);
		if (!fm) return `${name}: no properties, skipped.`;
		const existing = getBlock(text);
		const existingConnections = getSection(text, CONNECTIONS_START, CONNECTIONS_END);
		// Places typed as plain text become links to place notes.
		const linked = this.places.linkify(fm);
		const current: Frontmatter = { ...fm, ...linked.changes };

		const status: string[] = [];
		// Marked people: no profile lookups, so (unless their papers come from ORCID) no ORCID request.
		const onlyPapers = !mode.single && papersOnly(fm);
		if (onlyPapers) status.push('papers only');
		const ids = readIds(fm);
		let { openalex: aid, orcid } = ids;
		let resolvedId = '';
		if (!aid && !ids.notOnOpenAlex && orcid) {
			aid = resolvedId = await src.authorFromOrcid(orcid);
			if (!aid) status.push('ORCID not on OpenAlex');
		}
		const author = aid ? await src.author(aid) : {};
		orcid ||= matchOrcid(author.orcid);
		if (orcid) seen?.add(orcid);
		// ORCID records rarely change, so between full updates each is fetched at most every few days.
		// For marked people it's only needed when their papers come from it (they're not on OpenAlex).
		const needOrcid = !!orcid && (!onlyPapers || !aid);
		const checkOrcid = needOrcid && (mode.full || this.orcidDue(orcid));
		const record = checkOrcid ? await src.orcidRecord(orcid) : {};
		if (checkOrcid) this.settings.orcidChecked[orcid] = Date.now();
		// Without a fresh ORCID record the profile can't be worked out; it was filled when it was last checked.
		// What their places' notes should say, from what's known about them (also used to describe
		// places converted from text, so those notes get details too).
		const raw = rawProfile(author, record);
		const placeIds = [...raw.institutions, ...raw.previous].flatMap((p) => (p.id ? [p.id] : []));
		const planned = this.places.values(raw, await src.institutions(this.places.missing(placeIds)));
		const found: Profile = !onlyPapers && (checkOrcid || !orcid) ? planned.values : {};
		const specs = planned.specs;
		for (const path of linked.specs.keys()) {
			const known = specs.get(path);
			if (known) linked.specs.set(path, known);
		}
		const fills = profileChanges(current, found, mode.refresh);
		const filled = Object.keys(fills);
		if (filled.length) status.push('filled ' + filled.join(', '));
		const derived: Frontmatter = {};
		let connectionsBlock = existingConnections;

		let block: string;
		const shown = existing === null ? null : worksSummary(existing);
		if (aid && !author.id) {
			block = unknownAuthor(aid);
			status.push(`OpenAlex has no author ${aid}`);
		} else if (aid && existing !== null && existingConnections !== null && !mode.full
			&& shown?.source === `https://openalex.org/${aid}` && shown.count === author.works_count
			&& shown.listed === Math.min(author.works_count ?? 0, this.settings.papersPerPerson)) {
			// Same number of works as last time: the latest ones, and who they're with, haven't changed.
			block = existing;
			status.push('papers unchanged');
		} else if (aid) {
			const { works, details } = await src.works(aid);
			block = renderWorks(`[OpenAlex](https://openalex.org/${aid})`, author.works_count, works);
			status.push(`${works.length} papers from OpenAlex`);
			// Collaborators, research tags and the likely PI all come from the same papers.
			const c = connections(aid, author.display_name ?? name, details);
			connectionsBlock = renderConnections(c, this.connectionLinks(file.path));
			const tags = researchTags(details);
			derived.methods = tags.methods;
			derived.model_systems = tags.modelSystems;
			if (!onlyPapers && c.pi) derived.lab = this.personLink(c.pi, file.path);
		} else if (orcid && !checkOrcid && existing !== null) {
			block = existing;
			status.push('ORCID checked recently');
		} else if (record['activities-summary']) {
			const { total, works } = orcidWorks(record, orcid, this.settings.papersPerPerson);
			block = renderWorks(`[ORCID](https://orcid.org/${orcid})`, total, works);
			status.push(`${works.length} papers from ORCID`);
		} else if (ids.notOnOpenAlex) {
			block = NOT_ON_OPENALEX;
			status.push('not on OpenAlex');
		} else if (existing !== null && !mode.full && isCandidateList(existing)) {
			// Suggestions are waiting for you to pick one; searching again would find the same people.
			block = existing;
			status.push('no ID; OpenAlex matches already suggested in the note');
		} else {
			const inst: unknown = Array.isArray(fm.institutions) ? fm.institutions[0] : fm.institutions;
			const cands = await src.candidates(name, typeof inst === 'string' ? inst : '');
			block = renderCandidates(cands);
			status.push(`no ID; ${cands.length} OpenAlex matches suggested in the note`);
		}

		// Place notes for the links about to be written, and the city and country notes they link to.
		const written: unknown[] = [...Object.values(linked.changes as Record<string, unknown>), ...Object.values(fills as Record<string, unknown>)];
		await this.places.ensureLinked(written, new Map([...specs, ...linked.specs]));
		// Research tags are only ever added to: tags you wrote, or that were found before, are never removed.
		const derivedChanged = Object.entries(derived)
			.some(([k, v]) => (k === 'lab' ? isEmpty(fm.lab) : JSON.stringify(addToList(fm[k], v as string[])) !== JSON.stringify(fm[k] ?? [])));
		if (resolvedId || filled.length || Object.keys(linked.changes).length || derivedChanged) {
			await fileManager.processFrontMatter(file, (front: Frontmatter) => {
				// Decide against the note as it is now: it may have been edited during the lookups.
				if (resolvedId && isEmpty(front.openalex)) front.openalex = resolvedId;
				for (const [k, v] of Object.entries(linked.changes)) if (JSON.stringify(front[k]) === JSON.stringify(fm[k])) front[k] = v;
				const changes = keepOldPlaces(front, profileChanges(front, found, mode.refresh));
				for (const [k, v] of Object.entries(changes)) front[k] = v;
				if (derived.methods) front.methods = addToList(front.methods, derived.methods as string[]);
				if (derived.model_systems) front.model_systems = addToList(front.model_systems, derived.model_systems as string[]);
				if (derived.lab && isEmpty(front.lab)) front.lab = derived.lab;
			});
		}
		const write = (t: string) => {
			const withPapers = setBlock(t, block);
			const withConnections = connectionsBlock === null ? withPapers
				: setSection(withPapers, CONNECTIONS_START, CONNECTIONS_END, 'Collaborators', connectionsBlock);
			return withCard(withConnections);
		};
		const latest = await vault.read(file);
		if (write(latest) !== latest) await vault.process(file, write);
		return `${name}: ${status.join('; ')}.`;
	}

	private orcidDue(orcid: string): boolean {
		const last = this.settings.orcidChecked[orcid];
		return !last || Date.now() - last >= this.settings.orcidRecheckDays * 864e5;
	}

	/** Drop check times for ORCIDs no longer in any note, so the saved state doesn't grow forever. */
	private forgetOrcidChecks(seen: Set<string>): void {
		for (const orcid of Object.keys(this.settings.orcidChecked)) {
			if (!seen.has(orcid)) delete this.settings.orcidChecked[orcid];
		}
	}

	/** Save an image as the person's photo: a (shrunk) attachment and the `photo` property, shown on their card. */
	async setPhoto(file: TFile, image: PhotoImage): Promise<string> {
		const { vault, fileManager, metadataCache } = this.app;
		// Twice the display width keeps it sharp on high-resolution screens.
		const small = await shrinkPhoto(image, Math.max(512, 2 * this.settings.photoWidth));
		// In the photos folder if one is set, else where Obsidian's attachment settings say; never overwrites.
		const folder = this.settings.photosFolder.trim();
		const path = folder
			? await availablePath(this.app, folder, safeName(file.basename), small.ext)
			: await fileManager.getAvailablePathForAttachment(`${file.basename}.${small.ext}`, file.path);
		const saved = await vault.createBinary(path, small.data);
		const link = `[[${metadataCache.fileToLinktext(saved, file.path)}]]`;
		await fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			fm.photo = link;
		});
		const text = await vault.read(file);
		if (withCard(text) !== text) await vault.process(file, withCard);
		return `Saved ${file.basename}'s photo as ${path}.`;
	}

	/** What a person note holds, re-read only if it changed since last time. */
	private async scan(file: TFile) {
		let scan = this.scans.get(file.path);
		if (scan?.mtime !== file.stat.mtime) {
			const text = await this.app.vault.cachedRead(file);
			scan = {
				mtime: file.stat.mtime,
				papers: blockPapers(text),
				pending: pendingTargets(getSection(text, CONNECTIONS_START, CONNECTIONS_END) ?? ''),
			};
			this.scans.set(file.path, scan);
		}
		return scan;
	}

	/** Whether a new, empty note is one a collaborators block links to. */
	async isPendingCreation(file: TFile): Promise<boolean> {
		return (await this.pendingId(file)) !== undefined;
	}

	private async pendingId(file: TFile): Promise<string | undefined> {
		const target = file.path.replace(/\.md$/, '');
		for (const person of this.list()) {
			if (person.path === file.path) continue;
			const id = (await this.scan(person)).pending.get(target);
			if (id) return id;
		}
		return undefined;
	}

	/**
	 * A note was just created. If it's an empty note that a collaborators
	 * block links to (someone clicked the link), fill it in: a person gets the
	 * template and their OpenAlex ID and is looked up; an institution or
	 * country gets its details. Returns a status, or null if it's not ours.
	 */
	async created(file: TFile): Promise<string | null> {
		if (file.extension !== 'md' || (await this.app.vault.read(file)).trim()) return null;
		const id = await this.pendingId(file);
		if (!id) return null;
		if (/^A\d+$/.test(id)) { // an OpenAlex author: a person
			const template = this.app.vault.getFileByPath(normalizePath(this.settings.templateFile));
			const content = template ? await this.app.vault.read(template) : DEFAULT_TEMPLATE;
			await this.app.vault.process(file, (t) => (t.trim() ? t : content));
			await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => { fm.openalex = id; });
			await this.tagAsPerson(file);
			this.byId = null;
			return this.updateOne(file);
		}
		const detail = /^I\d+$/.test(id) ? (await this.sources().institutions([id])).get(id) : undefined;
		await this.places.fillNew(file, id, detail);
		return `Filled in ${file.basename}.`;
	}

	/** Rebuild the research feed from every person's papers block; return its size. */
	async writeFeed(): Promise<number> {
		const { vault } = this.app;
		const days = this.settings.feedDays;
		const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
		const items: [string, string, string][] = [];
		for (const file of this.list()) {
			for (const [date, rest] of (await this.scan(file)).papers) {
				if (date >= cutoff) items.push([date, file.basename, rest]);
			}
		}
		const content = renderFeed(items, days);
		const path = normalizePath(this.settings.feedFile || 'Research feed.md');
		let feed = vault.getFileByPath(path);
		const known = feed && this.feedWritten?.path === path && this.feedWritten.mtime === feed.stat.mtime;
		if (known && this.feedWritten?.content === content) return items.length;
		if (feed) {
			// Only the marked list is rewritten; anything else in the note is kept.
			const current = await vault.cachedRead(feed);
			if (feedWithSection(current, content) !== current) await vault.process(feed, (t) => feedWithSection(t, content));
		} else {
			const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
			if (dir && !vault.getFolderByPath(dir)) await vault.createFolder(dir);
			feed = await vault.create(path, feedWithSection('', content));
		}
		this.feedWritten = { path, mtime: (vault.getFileByPath(path) ?? feed).stat.mtime, content };
		return items.length;
	}
}

/** Run `fn` over `items` with at most `limit` running at once; start no more once `stopped()`. */
async function eachLimit<T>(items: T[], limit: number, stopped: () => boolean, fn: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (!stopped()) {
			const item = items[next++];
			if (item === undefined) return;
			await fn(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
