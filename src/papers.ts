/**
 * The markdown this plugin writes: the papers block in each person note and
 * the research feed. Pure functions, no Obsidian imports.
 */
import type { Candidate, Work } from './types.ts';
import { keepAfter, sign, unsigned, userLines } from './managed.ts';
import { lastPart } from './profile.ts';

export const START = '<!-- papers:start -->';
export const END = '<!-- papers:end -->';

/** Neutralise characters that would break a markdown link or wikilink. */
function mdText(s: string): string {
	return s.replace(/<[^>]+>/g, '').replace(/([[\]|])/g, '\\$1');
}

/** Percent-encode what would end a markdown link destination early. */
function mdUrl(url: string): string {
	return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export function paperLine(w: Work): string {
	const parts = [w.date || 'n.d.', `[${mdText(w.title)}](${mdUrl(w.url)})`];
	if (w.venue) parts.push(`*${mdText(w.venue)}*`);
	return '- ' + parts.join(' · ');
}

/** `source` is a markdown link to where the works came from. */
export function renderWorks(source: string, count: number | undefined, works: Work[]): string {
	let head = `*From ${source}`;
	head += count != null ? ` · ${count} works in total*` : '*';
	if (!works.length) return head + '\n\n_No papers found yet._\n';
	return head + '\n\n' + works.map(paperLine).join('\n') + '\n';
}

export function renderCandidates(cands: Candidate[]): string {
	const lines = [
		'> [!question] Which OpenAlex author is this?',
		'> Paste the right ID into the `openalex` property, then run *Scholar Atlas: Update this person*.',
		'> If none of these is them, write `none` there instead.',
	];
	if (!cands.length) lines.push('> No matches found by name. Add an `orcid` or `openalex` ID by hand.');
	for (const a of cands) {
		const bits = [`\`${lastPart(a.id)}\``, `[${mdText(a.display_name)}](${a.id})`];
		if (a.orcid) bits.push('ORCID ' + lastPart(a.orcid));
		const insts = (a.last_known_institutions ?? []).slice(0, 2)
			.map((i) => i.display_name).filter(Boolean).join(', ');
		if (insts) bits.push(mdText(insts));
		bits.push(`${a.works_count ?? 0} works`);
		lines.push('> - ' + bits.join(' · '));
	}
	return lines.join('\n') + '\n';
}

export const NOT_ON_OPENALEX = '_Not on OpenAlex or ORCID. Add papers by hand outside these markers._\n';

export function unknownAuthor(aid: string): string {
	return `_OpenAlex has no author \`${aid}\`. Check the \`openalex\` property._\n`;
}

/** The raw text between two markers (with its signature); null if they're missing. */
export function rawSection(text: string, start: string, end: string): string | null {
	const i = text.indexOf(start);
	const j = text.indexOf(end);
	if (i === -1 || j === -1 || j < i) return null;
	return text.slice(i + start.length + 1, j);
}

/** The content between two markers, without its signature; null if they're missing. */
export function getSection(text: string, start: string, end: string): string | null {
	const raw = rawSection(text, start, end);
	return raw === null ? null : unsigned(raw);
}

/**
 * Write a section between two markers (adding them under `## heading` at the
 * end if missing). A section that's unchanged is left exactly as it is;
 * anything you wrote in a section being replaced is kept, just below it.
 */
export function setSection(text: string, start: string, end: string, heading: string, block: string): string {
	const raw = rawSection(text, start, end);
	if (raw === null) return text.replace(/\n*$/, '') + `\n\n## ${heading}\n${start}\n${sign(block)}${end}\n`;
	if (unsigned(raw) === block) return text;
	const kept = userLines(raw);
	const i = text.indexOf(start);
	const j = text.indexOf(end);
	return keepAfter(text.slice(0, i + start.length) + '\n' + sign(block) + text.slice(j), end, kept);
}

/** The text between the papers markers; null if there are none. */
export function getBlock(text: string): string | null {
	return getSection(text, START, END);
}

/** What a papers block written by {@link renderWorks} shows: its source link, the total and how many papers it lists. */
export function worksSummary(block: string): { source: string; count: number | null; listed: number } | null {
	const m = block.match(/^\*From \[[^\]]+\]\(([^)]+)\)(?: · (\d+) works in total)?\*/);
	if (!m?.[1]) return null;
	return { source: m[1], count: m[2] ? Number(m[2]) : null, listed: block.match(/^- /gm)?.length ?? 0 };
}

/** Whether a papers block holds OpenAlex suggestions still waiting for you to pick one. */
export function isCandidateList(block: string): boolean {
	return block.startsWith('> [!question]');
}

/** Replace the text between the papers markers, adding them if missing. */
export function setBlock(text: string, block: string): string {
	return setSection(text, START, END, 'Papers', block);
}

/** Dated paper lines in a note's papers block, as [date, line without its leading "- date · "]. */
export function blockPapers(text: string): [string, string][] {
	const i = text.indexOf(START);
	const j = text.indexOf(END);
	if (i === -1 || j < i) return [];
	const out: [string, string][] = [];
	for (const line of text.slice(i + START.length, j).split('\n')) {
		const m = line.match(/^- (\d{4}(?:-\d{2}){0,2}) · (.+)$/);
		if (m?.[1] && m[2]) out.push([m[1], m[2]]);
	}
	return out;
}

export const FEED_START = '<!-- feed:start -->';
export const FEED_END = '<!-- feed:end -->';

/**
 * The feed note with its list replaced, keeping everything else in it. A feed
 * note from an earlier version (one list, no markers) keeps any properties
 * and any lines you added.
 */
export function feedWithSection(text: string, section: string): string {
	if (rawSection(text, FEED_START, FEED_END) !== null) return setSection(text, FEED_START, FEED_END, 'Research feed', section);
	const front = text.match(/^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/)?.[0] ?? '';
	const kept = userLines(text.slice(front.length));
	return `${front}${FEED_START}\n${sign(section)}${FEED_END}\n${kept.length ? `\n${kept.join('\n')}\n` : ''}`;
}

/**
 * Items are [date, person note name, rest of the paper line]. A paper by
 * several people in the network is listed once, with all of them.
 */
export function renderFeed(items: [string, string, string][], days: number): string {
	const papers = new Map<string, { date: string; rest: string; people: string[] }>();
	for (const [date, person, rest] of items) {
		const key = `${date} ${rest}`;
		const paper = papers.get(key) ?? { date, rest, people: [] };
		if (!paper.people.includes(person)) paper.people.push(person);
		papers.set(key, paper);
	}
	const lines = [...papers.values()]
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
		.map((p) => `- ${p.date} · ${p.people.sort().map((n) => `[[${n}]]`).join(', ')} · ${p.rest}`);
	// No heading: Obsidian shows the note's own (configurable) name as its title.
	const out = [`Papers from the last ${days} days by people in the network. ` +
		'Updated by the Scholar Atlas plugin; anything you add above or below this list is kept.', ''];
	if (lines.length) out.push(...lines);
	else out.push('_Nothing new in this window._');
	return out.join('\n') + '\n';
}
