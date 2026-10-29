/**
 * Who someone works with, from the authors of their latest papers: co-authors,
 * collaborating institutions and companies, countries, and their likely PI.
 * Pure functions, no Obsidian imports.
 */
import { countryName } from './countries.ts';
import { lastPart, stripAccents } from './profile.ts';
import type { WorkDetail } from './types.ts';

export const CONNECTIONS_START = '<!-- collaborators:start -->';
export const CONNECTIONS_END = '<!-- collaborators:end -->';

/** Papers with more authors than this are consortium papers: they say little about who someone works with. */
const MAX_AUTHORS = 50;
const MAX_COAUTHORS = 15;
const MAX_PLACES = 10;
/** An institution counts as a collaborator from this many shared papers; companies from one. */
const MIN_INSTITUTION_PAPERS = 2;

/**
 * Parent organisations that would otherwise drown out the institution people
 * actually work with (from neuro-labs-explorer's pipeline/umbrellas.json).
 */
const UMBRELLAS = new Set([
	'I1294671590', 'I154526488', 'I2738703131', 'I4210097159', 'I4210096427', 'I149899117',
	'I1305996414', 'I315704651', 'I124357947', 'I1299303238', 'I1299022934', 'I1322918889',
	'I2799886695', 'I1344073410', 'I48633490', 'I2799853436',
]);

/**
 * A key that's the same for one person's split OpenAlex profiles, e.g.
 * "Jorge F. Mejías" and "Mejias Jorge F.": accents, punctuation and word order
 * don't matter.
 */
export function nameKey(name: string): string {
	return stripAccents(name).toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean).sort().join(' ');
}

export interface Collaborator {
	/** OpenAlex ID of the profile with the most shared papers. */
	id: string;
	name: string;
	papers: number;
}

export interface Place {
	id: string;
	name: string;
	papers: number;
}

export interface Connections {
	/** How many papers this is based on. */
	basis: number;
	coauthors: Collaborator[];
	institutions: Place[];
	companies: Place[];
	countries: { code: string; name: string; papers: number }[];
	/** Most frequent other last author, if clear enough to be their PI. */
	pi: Collaborator | null;
}

/**
 * Between spellings of one person's name seen equally often, prefer
 * "Jorge F. Mejías" to "Mejias Jorge F.": not surname-first (ending in an
 * initial), and with its accents.
 */
function nameQuality(name: string): number {
	return (/\b\p{L}\.?$/u.test(name.trim()) ? 0 : 2) + (/[\u00c0-\u024f]/.test(name) ? 1 : 0);
}

/** Tally of one person's papers, merged across their split profiles. */
class Tally {
	private readonly byKey = new Map<string, { names: Map<string, number>; ids: Map<string, number>; papers: number }>();

	add(key: string, id: string, name: string): void {
		const t = this.byKey.get(key) ?? { names: new Map(), ids: new Map(), papers: 0 };
		t.papers++;
		t.names.set(name, (t.names.get(name) ?? 0) + 1);
		t.ids.set(id, (t.ids.get(id) ?? 0) + 1);
		this.byKey.set(key, t);
	}

	top(limit: number, min = 1): Collaborator[] {
		const best = (m: Map<string, number>, score: (k: string) => number = () => 0) =>
			[...m].sort((a, b) => b[1] - a[1] || score(b[0]) - score(a[0]))[0]?.[0] ?? '';
		return [...this.byKey.values()].filter((t) => t.papers >= min)
			.map((t) => ({ id: best(t.ids), name: best(t.names, nameQuality), papers: t.papers }))
			.sort((a, b) => b.papers - a.papers || a.name.localeCompare(b.name))
			.slice(0, limit);
	}
}

function count<T extends { id: string; name: string }>(items: Map<string, T & { papers: number }>, item: T): void {
	const seen = items.get(item.id);
	if (seen) seen.papers++;
	else items.set(item.id, { ...item, papers: 1 });
}

/** Who `aid` works with, from their papers. `name` lets their own split profiles be recognised. */
export function connections(aid: string, name: string, works: WorkDetail[]): Connections {
	const self = nameKey(name);
	const isSelf = (a: { id: string; name: string }) => a.id === aid || (!!self && nameKey(a.name) === self);
	const coauthors = new Tally();
	const lastAuthors = new Tally();
	const institutions = new Map<string, Place & { type: string }>();
	const countries = new Map<string, number>();
	let basis = 0;
	let ledByOthers = 0;

	for (const w of works) {
		if (w.authors.length > MAX_AUTHORS || !w.authors.some((a) => a.id === aid)) continue;
		basis++;
		const own = new Set(w.authors.filter(isSelf).flatMap((a) => a.institutions.map((i) => lastPart(i.id))));
		const others = w.authors.filter((a) => !isSelf(a));
		const seenPeople = new Set<string>();
		const seenPlaces = new Set<string>();
		const seenCountries = new Set<string>();
		for (const a of others) {
			const key = nameKey(a.name) || a.id;
			if (!seenPeople.has(key)) {
				seenPeople.add(key);
				coauthors.add(key, a.id, a.name);
			}
			for (const inst of a.institutions) {
				const id = lastPart(inst.id);
				if (inst.country_code && !seenCountries.has(inst.country_code)) {
					seenCountries.add(inst.country_code);
					countries.set(inst.country_code, (countries.get(inst.country_code) ?? 0) + 1);
				}
				if (own.has(id) || UMBRELLAS.has(id) || seenPlaces.has(id) || !inst.display_name) continue;
				seenPlaces.add(id);
				count(institutions, { id, name: inst.display_name, type: inst.type ?? '' });
			}
		}
		const last = w.authors[w.authors.length - 1];
		if (last && w.authors.length > 1 && !isSelf(last)) {
			ledByOthers++;
			lastAuthors.add(nameKey(last.name) || last.id, last.id, last.name);
		}
	}

	// Their PI: the same other last author on at least 2 papers and 40% of those led by others.
	const lead = lastAuthors.top(1)[0];
	const pi = lead && lead.papers >= 2 && lead.papers >= 0.4 * ledByOthers ? lead : null;
	const places = [...institutions.values()].sort((a, b) => b.papers - a.papers || a.name.localeCompare(b.name));
	const strip = ({ id, name, papers }: Place) => ({ id, name, papers });
	return {
		basis,
		coauthors: coauthors.top(MAX_COAUTHORS),
		companies: places.filter((p) => p.type === 'company').slice(0, MAX_PLACES).map(strip),
		institutions: places.filter((p) => p.type !== 'company' && p.papers >= MIN_INSTITUTION_PAPERS).slice(0, MAX_PLACES).map(strip),
		countries: [...countries].map(([code, n]) => ({ code, name: countryName(code), papers: n }))
			.sort((a, b) => b.papers - a.papers || a.name.localeCompare(b.name)).slice(0, MAX_PLACES),
		pi,
	};
}

export interface ConnectionLinks {
	person: (c: Collaborator) => string;
	institution: (p: Place) => string;
	country: (code: string, name: string) => string;
}

const papers = (n: number) => `${n} paper${n === 1 ? '' : 's'}`;

/**
 * The collaborators block. Each line ends with a hidden `%%id%%` so that
 * clicking a link to a note that doesn't exist yet can create and fill it.
 */
export function renderConnections(c: Connections, link: ConnectionLinks): string {
	if (!c.basis) return '_No co-authors found on their latest papers._\n';
	const out = [`*From their latest ${papers(c.basis)}*`, ''];
	const section = (title: string, lines: string[]) => {
		if (lines.length) out.push(`**${title}**`, ...lines, '');
	};
	section('Co-authors', c.coauthors.map((p) => `- ${link.person(p)} · ${papers(p.papers)} %%${p.id}%%`));
	section('Companies', c.companies.map((p) => `- ${link.institution(p)} · ${papers(p.papers)} %%${p.id}%%`));
	section('Institutions', c.institutions.map((p) => `- ${link.institution(p)} · ${papers(p.papers)} %%${p.id}%%`));
	section('Countries', c.countries.map((p) => `- ${link.country(p.code, p.name)} · ${papers(p.papers)} %%${p.code}%%`));
	return out.join('\n').replace(/\n+$/, '\n');
}

/** Link targets in a collaborators block with their hidden IDs: note path (no `.md`) -> ID. */
export function pendingTargets(block: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const m of block.matchAll(/^- \[\[([^\]|]+)(?:\|[^\]]*)?\]\][^\n]*%%([A-Za-z0-9]+)%%$/gm)) {
		if (m[1] && m[2]) out.set(m[1], m[2]);
	}
	return out;
}
