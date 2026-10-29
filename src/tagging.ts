/**
 * Tagging people with research methods and model systems from their papers,
 * using the vocabulary ported from neuro-labs-explorer (see vocab.ts). Pure
 * functions, no Obsidian imports.
 */
import { VOCAB, type VocabTag } from './vocab.ts';

const DASHES = /[‐‑‒–—−]/g;

/** Lowercase, unify dashes and collapse whitespace, as the vocabulary expects. */
function normalise(text: string): string {
	return text.toLowerCase().replace(DASHES, '-').replace(/\s+/g, ' ').trim();
}

interface Compiled {
	tag: VocabTag;
	rx: RegExp | null;
	unless: RegExp | null;
	mesh: Set<string>;
}

let compiled: Compiled[] | null = null;

function vocab(): Compiled[] {
	compiled ??= VOCAB.map((tag) => ({
		tag,
		rx: tag.pattern ? new RegExp(tag.pattern) : null,
		unless: tag.unless ? new RegExp(tag.unless, 'g') : null,
		mesh: new Set(tag.mesh),
	}));
	return compiled;
}

/** Ids of the tags that match one paper's text (title + abstract) or MeSH terms. */
export function tagIds(text: string, mesh: string[] = []): string[] {
	const t = normalise(text);
	return vocab().filter(({ rx, unless, mesh: tagMesh }) => {
		if (mesh.some((m) => tagMesh.has(m))) return true;
		return !!rx && rx.test(unless ? t.replace(unless, ' ') : t);
	}).map(({ tag }) => tag.id);
}

export interface TaggableWork {
	text: string;
	mesh: string[];
}

/**
 * The methods and model systems a person works with: tags found on at least
 * two of their papers (one, if they have fewer than three), most frequent
 * first, at most `max` of each.
 */
export function researchTags(works: TaggableWork[], max = 8): { methods: string[]; modelSystems: string[] } {
	const counts = new Map<string, number>();
	for (const w of works) for (const id of tagIds(w.text, w.mesh)) counts.set(id, (counts.get(id) ?? 0) + 1);
	const min = works.length < 3 ? 1 : 2;
	const pick = (group: VocabTag['group']) => vocab()
		.filter(({ tag }) => tag.group === group && (counts.get(tag.id) ?? 0) >= min)
		.sort((a, b) => (counts.get(b.tag.id) ?? 0) - (counts.get(a.tag.id) ?? 0))
		.slice(0, max)
		.map(({ tag }) => tag.label);
	return { methods: pick('methods'), modelSystems: pick('modelSystems') };
}
