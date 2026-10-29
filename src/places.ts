/**
 * Notes for institutions, cities and countries, so a person's places are
 * links: their local graph shows where they work and live, and each place
 * note lists its people. Place notes are only created when missing; after
 * that, only their empty properties are filled.
 */
import { type App, normalizePath, stringifyYaml, TFile, Vault } from 'obsidian';
import { countryCode, countryName } from './countries.ts';
import { ensureFolder } from './folders.ts';
import { isEmpty } from './profile.ts';
import { peopleSelector, type ScholarAtlasSettings } from './settings.ts';
import { baseFilter } from './selector.ts';
import type { Frontmatter, InstitutionDetail, Profile, RawPlace, RawProfile } from './types.ts';

type Kind = 'Institutions' | 'Cities' | 'Countries';

/** What a place note should say, for creating or filling it. */
interface PlaceSpec {
	kind: Kind;
	path: string;
	props: Frontmatter;
}

/** Remove what can't go in a file name. */
export function safeName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
}

/** A name as a link alias: without the characters that would end the link early. */
export function linkAlias(name: string): string {
	return name.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The name in a `[[path|name]]` or `[[name]]` link, or the text itself. */
export function linkName(value: unknown): string {
	if (typeof value !== 'string') return '';
	const m = value.match(/^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/);
	if (!m) return value.trim();
	return (m[2] ?? m[1]?.split('/').pop() ?? '').trim();
}

const isLink = (v: unknown) => typeof v === 'string' && /^\[\[.*\]\]$/.test(v.trim());

function peopleBase(peopleFilter: string, views: [string, string][]): string {
	return [
		'```base',
		'filters:',
		'  and:',
		`    - ${JSON.stringify(peopleFilter)}`,
		'views:',
		...views.flatMap(([name, filter]) => [
			'  - type: table',
			`    name: ${name}`,
			'    filters:',
			'      and:',
			`        - ${JSON.stringify(filter)}`,
		]),
		'```',
	].join('\n');
}

export class Places {
	private readonly app: App;
	private readonly settings: ScholarAtlasSettings;
	/** OpenAlex institution ID -> path of its note, built from note properties. */
	private byId: Map<string, string> | null = null;
	/** Creations in flight, so people updated in parallel don't create the same note twice. */
	private readonly creating = new Map<string, Promise<void>>();
	/**
	 * Properties of the notes created in this run. Obsidian indexes a new note
	 * a moment after it's written, so until then they're looked up here: a
	 * same-named place in another country is told apart even when the two are
	 * created moments apart by people updated in parallel.
	 */
	private readonly created = new Map<string, Frontmatter>();

	constructor(app: App, settings: ScholarAtlasSettings) {
		this.app = app;
		this.settings = settings;
	}

	folder(kind: Kind): string {
		return normalizePath(`${this.settings.placesFolder || 'Places'}/${kind}`);
	}

	/** Forget the note index, e.g. at the start of a run. */
	reset(): void {
		this.byId = null;
		this.created.clear();
	}

	private index(): Map<string, string> {
		if (!this.byId) {
			this.byId = new Map();
			const root = this.app.vault.getFolderByPath(this.folder('Institutions'));
			if (root) {
				Vault.recurseChildren(root, (file) => {
					if (!(file instanceof TFile) || file.extension !== 'md') return;
					const id = this.app.metadataCache.getFileCache(file)?.frontmatter?.openalex as unknown;
					if (typeof id === 'string' && id) this.byId?.set(id, file.path.replace(/\.md$/, ''));
				});
			}
		}
		return this.byId;
	}

	/** OpenAlex IDs of institutions that don't have a note yet, so their details are worth fetching. */
	missing(ids: string[]): string[] {
		return ids.filter((id) => !this.index().has(id));
	}

	private props(path: string): Frontmatter | undefined {
		const file = this.app.vault.getFileByPath(`${path}.md`);
		if (!file) return undefined;
		return this.app.metadataCache.getFileCache(file)?.frontmatter ?? this.created.get(path);
	}

	link(path: string): string {
		return `[[${path}|${path.split('/').pop() ?? path}]]`;
	}

	// --- where each place's note is ---------------------------------------------

	private countryPath(code: string): string {
		return `${this.folder('Countries')}/${safeName(countryName(code))}`;
	}

	/** A city's note; a same-named city in another country gets the country added. */
	private cityPath(city: string, code?: string): string {
		const plain = `${this.folder('Cities')}/${safeName(city)}`;
		const existing = this.props(plain);
		if (!code || !existing || !existing.country_code || existing.country_code === code) return plain;
		return `${this.folder('Cities')}/${safeName(`${city} (${countryName(code)})`)}`;
	}

	/** An institution's note: found by OpenAlex ID, else by name (country added on a clash). */
	private institutionPath(place: RawPlace): string {
		const known = place.id ? this.index().get(place.id) : undefined;
		if (known) return known;
		const plain = `${this.folder('Institutions')}/${safeName(place.name)}`;
		const existing = this.props(plain);
		if (!existing || !place.id || !existing.openalex || existing.openalex === place.id || !place.countryCode) return plain;
		return `${this.folder('Institutions')}/${safeName(`${place.name} (${countryName(place.countryCode)})`)}`;
	}

	/** A link to an institution's note, which may not exist yet. */
	institutionLink(place: RawPlace): string {
		return this.link(this.institutionPath(place));
	}

	/** A link to a country's note, which may not exist yet. */
	countryLink(code: string): string {
		return this.link(this.countryPath(code));
	}

	// --- turning a profile into links ------------------------------------------

	/**
	 * Link values for a person's place properties, plus what each linked note
	 * should say. Nothing is created here: call {@link ensure} with the specs
	 * of the values actually written.
	 */
	values(raw: RawProfile, details: Map<string, InstitutionDetail>): { values: Profile; specs: Map<string, PlaceSpec> } {
		const specs = new Map<string, PlaceSpec>();
		const add = (spec: PlaceSpec) => {
			if (!specs.has(spec.path)) specs.set(spec.path, spec);
			return this.link(spec.path);
		};
		const country = (code: string | undefined) => (code ? add({
			kind: 'Countries', path: this.countryPath(code), props: { country_code: code.toUpperCase() },
		}) : undefined);
		const city = (name: string | undefined, code: string | undefined, lat?: number, lon?: number) => (name ? add({
			kind: 'Cities',
			path: this.cityPath(name, code),
			props: { country: country(code) ?? null, country_code: code ?? null, location: lat != null && lon != null ? [lat, lon] : null },
		}) : undefined);
		const institution = (p: RawPlace) => {
			const d = p.id ? details.get(p.id) : undefined;
			const code = d?.countryCode ?? p.countryCode;
			return add({
				kind: 'Institutions',
				path: this.institutionPath(p),
				props: {
					type: d?.type ?? p.type ?? null,
					city: city(d?.city ?? p.city, code, d?.lat, d?.lon) ?? null,
					country: country(code) ?? null,
					location: d?.lat != null && d.lon != null ? [d.lat, d.lon] : null,
					ror: d?.ror ?? null,
					openalex: p.id ?? null,
				},
			});
		};

		const institutions = raw.institutions.map(institution);
		const previous = raw.previous.map(institution);
		// City and country of where they work now: from ORCID directly, else from the institution's details or note.
		const first = raw.institutions[0];
		const d = first?.id ? details.get(first.id) : undefined;
		const firstPath = first ? this.institutionPath(first) : '';
		const firstNote = firstPath ? this.props(firstPath) : undefined;
		const code = raw.countryCode ?? d?.countryCode ?? (firstNote?.country_code as string | undefined);
		let cityLink = city(raw.city ?? d?.city, code, d?.lat, d?.lon);
		if (!cityLink && isLink(firstNote?.city)) cityLink = firstNote?.city as string;
		const values: Profile = {
			institutions,
			previous_institutions: previous,
			city: cityLink ?? '',
			country: country(code) ?? '',
			website: raw.website ?? '',
			linkedin: raw.linkedin ?? '',
			email: raw.email ?? '',
			orcid: raw.orcid ?? '',
		};
		return { values: Object.fromEntries(Object.entries(values).filter(([, v]) => !isEmpty(v))), specs };
	}

	/**
	 * Place properties typed as plain text, rewritten as links to (new) place
	 * notes: what to change, and the notes to create.
	 */
	linkify(fm: Frontmatter): { changes: Frontmatter; specs: Map<string, PlaceSpec> } {
		const changes: Frontmatter = {};
		const specs = new Map<string, PlaceSpec>();
		const add = (spec: PlaceSpec) => {
			if (!specs.has(spec.path)) specs.set(spec.path, spec);
			return this.link(spec.path);
		};
		const countryText = typeof fm.country === 'string' && !isLink(fm.country) ? fm.country.trim() : '';
		const code = countryText ? countryCode(countryText) ?? undefined : undefined;
		if (countryText) {
			changes.country = add(code
				? { kind: 'Countries', path: this.countryPath(code), props: { country_code: code } }
				: { kind: 'Countries', path: `${this.folder('Countries')}/${safeName(countryText)}`, props: {} });
		}
		if (typeof fm.city === 'string' && fm.city.trim() && !isLink(fm.city)) {
			changes.city = add({
				kind: 'Cities',
				path: this.cityPath(fm.city.trim(), code),
				props: { country: (changes.country) ?? (isLink(fm.country) ? fm.country : null), country_code: code ?? null },
			});
		}
		for (const key of ['institutions', 'previous_institutions']) {
			const list = fm[key];
			if (!Array.isArray(list) || !list.some((v) => typeof v === 'string' && v.trim() && !isLink(v))) continue;
			changes[key] = list.map((v: unknown) => (typeof v === 'string' && v.trim() && !isLink(v)
				? add({ kind: 'Institutions', path: this.institutionPath({ name: v.trim() }), props: {} })
				: v));
		}
		return { changes, specs };
	}

	/** Create the notes for these places, or fill their empty properties. */
	async ensure(specs: Iterable<PlaceSpec>): Promise<void> {
		for (const spec of specs) await this.ensureOne(spec);
	}

	/**
	 * Create the place notes that these written values link to, and the city
	 * and country notes those link to in turn.
	 */
	async ensureLinked(written: unknown[], specs: Map<string, PlaceSpec>): Promise<void> {
		const todo = written.flat().filter((v): v is string => typeof v === 'string');
		const wanted = new Set<string>();
		while (todo.length) {
			const path = todo.pop()?.match(/^\[\[([^\]|]+)/)?.[1];
			const spec = path ? specs.get(path) : undefined;
			if (!spec || wanted.has(spec.path)) continue;
			wanted.add(spec.path);
			todo.push(...Object.values(spec.props).filter((v): v is string => typeof v === 'string'));
		}
		await this.ensure([...wanted].map((path) => specs.get(path)).filter((s): s is PlaceSpec => !!s));
	}

	private async ensureOne(spec: PlaceSpec): Promise<void> {
		const pending = this.creating.get(spec.path);
		if (pending) return pending;
		const job = this.write(spec).finally(() => this.creating.delete(spec.path));
		this.creating.set(spec.path, job);
		return job;
	}

	private async write(spec: PlaceSpec): Promise<void> {
		const { vault, fileManager } = this.app;
		const path = `${spec.path}.md`;
		const props = Object.fromEntries(Object.entries(spec.props).filter(([, v]) => !isEmpty(v)));
		const file = vault.getFileByPath(path);
		if (file) {
			const current = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (Object.keys(props).some((k) => isEmpty(current?.[k]))) {
				await fileManager.processFrontMatter(file, (fm: Frontmatter) => {
					for (const [k, v] of Object.entries(props)) if (isEmpty(fm[k])) fm[k] = v;
				});
			}
			return;
		}
		const dir = path.slice(0, path.lastIndexOf('/'));
		await ensureFolder(this.app, dir);
		// Properties and body in one write.
		const front = Object.keys(props).length ? `---\n${stringifyYaml(props)}---\n` : '';
		await vault.create(path, front + this.body(spec.kind));
		this.created.set(spec.path, props);
		if (typeof props.openalex === 'string') this.index().set(props.openalex, spec.path);
	}

	/** The body of a new place note: who's connected to it. */
	private body(kind: Kind): string {
		const people = baseFilter(peopleSelector(this.settings));
		const views: Record<Kind, [string, string][]> = {
			Institutions: [
				['Here now', 'list(institutions).contains(this)'],
				['Here before', 'list(previous_institutions).contains(this)'],
				['Collaborators', 'file.hasLink(this.file)'],
			],
			Cities: [['Lives here', 'list(city).contains(this)']],
			Countries: [['Lives here', 'list(country).contains(this)'], ['Collaborators', 'file.hasLink(this.file)']],
		};
		return `## People\n\n${peopleBase(people, views[kind])}\n`;
	}

	/** Fill a place note that was just created by clicking a link to it. */
	async fillNew(file: TFile, id: string, detail: InstitutionDetail | undefined): Promise<void> {
		const kind: Kind | null = file.path.startsWith(this.folder('Institutions') + '/') ? 'Institutions'
			: file.path.startsWith(this.folder('Countries') + '/') ? 'Countries' : null;
		if (!kind) return;
		await this.app.vault.process(file, (text) => (text.trim() ? text : this.body(kind)));
		if (kind === 'Countries') {
			await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => { fm.country_code ??= id; });
			return;
		}
		const { specs } = this.values({ institutions: [{ name: file.basename, id }], previous: [] },
			new Map<string, InstitutionDetail>(detail ? [[id, detail]] : []));
		const spec = specs.get(file.path.replace(/\.md$/, ''));
		if (!spec) return;
		await this.ensureLinked(Object.values(spec.props), new Map([...specs].filter(([path]) => path !== spec.path)));
		await this.app.fileManager.processFrontMatter(file, (fm: Frontmatter) => {
			for (const [k, v] of Object.entries(spec.props)) if (isEmpty(fm[k]) && !isEmpty(v)) fm[k] = v;
		});
		if (typeof spec.props.openalex === 'string') this.index().set(spec.props.openalex, spec.path);
	}
}

export type { PlaceSpec };
