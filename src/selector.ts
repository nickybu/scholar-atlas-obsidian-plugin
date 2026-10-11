/**
 * Which notes are people (or events): those in a folder, those with certain
 * tags, or both. Pure functions, no Obsidian imports.
 */

export type Match = 'any' | 'all';

export interface NoteSelector {
	/** Folder path; empty for none. */
	folder: string;
	/** Tags without `#`, lowercase; a note with a nested tag (`person/pi`) counts too. */
	tags: string[];
	/** With both a folder and tags: in the folder *or* tagged (`any`), or in it *and* tagged (`all`). */
	match: Match;
}

/** A selector, or (if it has neither a folder nor tags) one for `fallbackFolder`, so something is always selected. */
export function orFolder(sel: NoteSelector, fallbackFolder: string): NoteSelector {
	return sel.folder || sel.tags.length ? sel : { ...sel, folder: fallbackFolder };
}

/** "#person, Scientist  lab/pi" -> ["person", "scientist", "lab/pi"]. */
export function parseTags(text: string): string[] {
	return [...new Set(text.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))];
}

export function selector(folder: string, tags: string, match: Match): NoteSelector {
	return { folder: folder.trim().replace(/^\/+|\/+$/g, ''), tags: parseTags(tags), match };
}

/** Whether a note at `path` with these tags (with or without `#`) is selected. */
export function matches(sel: NoteSelector, path: string, noteTags: string[]): boolean {
	const inFolder = !!sel.folder && path.startsWith(`${sel.folder}/`);
	const own = noteTags.map((t) => t.replace(/^#/, '').toLowerCase());
	const tagged = sel.tags.some((t) => own.some((o) => o === t || o.startsWith(`${t}/`)));
	if (sel.folder && sel.tags.length) return sel.match === 'all' ? inFolder && tagged : inFolder || tagged;
	return sel.folder ? inFolder : tagged;
}

/** Tags to suggest while typing the last tag of a comma-separated list, leaving out ones already chosen. */
export function tagCompletions(vaultTags: string[], typed: string, limit = 20): string[] {
	const parts = typed.split(',');
	const current = (parts.pop() ?? '').trim().replace(/^#/, '').toLowerCase();
	const chosen = new Set(parts.map((t) => t.trim().replace(/^#/, '').toLowerCase()));
	return vaultTags.filter((t) => !chosen.has(t) && t.includes(current)).slice(0, limit);
}

/** The same test as a Bases filter expression, for the bases embedded in place notes. */
export function baseFilter(sel: NoteSelector): string {
	const folder = sel.folder ? `file.inFolder(${JSON.stringify(sel.folder)})` : '';
	const tags = sel.tags.length ? `file.hasTag(${sel.tags.map((t) => JSON.stringify(t)).join(', ')})` : '';
	if (folder && tags) return sel.match === 'all' ? `${folder} && ${tags}` : `(${folder} || ${tags})`;
	return folder || tags || 'false';
}
