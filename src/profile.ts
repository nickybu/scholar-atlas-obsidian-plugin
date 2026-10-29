/**
 * Turning OpenAlex and ORCID records into note properties. Pure functions, no
 * Obsidian imports, so they can be unit tested.
 */
import type {
	Affiliation, Author, Frontmatter, Institution, OrcidDate, OrcidJob, OrcidRecord, Profile, RawPlace, RawProfile, Work,
} from './types.ts';

const ORCID_RE = /\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i;
const OPENALEX_RE = /\bA\d+\b/;

/** Properties that describe where someone is now; written as a pair. */
const LOCATION = ['city', 'country'] as const;
/** List properties that refreshing locations overwrites. */
export const INSTITUTIONS = ['institutions', 'previous_institutions'] as const;

// ORCID links on these hosts are profiles, not someone's own website.
const SOCIAL_HOSTS = ['bsky.app', 'twitter.com', 'x.com', 'mastodon', 'github.com',
	'scholar.google', 'researchgate.net', 'linkedin.com', 'facebook.com',
	'instagram.com', 'youtube.com', 'orcid.org', 'loop.frontiersin.org'];

export function isEmpty(v: unknown): boolean {
	return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** The last path segment of an OpenAlex or ORCID URL. */
export function lastPart(id: string): string {
	return id.split('/').pop() ?? id;
}

export function matchOrcid(s: unknown): string {
	const m = (typeof s === 'string' ? s : '').match(ORCID_RE);
	return m ? m[0].toUpperCase() : '';
}

export function matchOpenAlex(s: unknown): string {
	return (typeof s === 'string' ? s : '').match(OPENALEX_RE)?.[0] ?? '';
}

/** "Mejías" -> "Mejias": the same name however it's accented, for searching and comparing. */
export function stripAccents(s: string): string {
	return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Drop empty names and case-insensitive duplicates, keeping the first spelling. */
export function unique(names: (string | null | undefined)[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const n of names) {
		if (n && !seen.has(n.toLowerCase())) {
			seen.add(n.toLowerCase());
			out.push(n);
		}
	}
	return out;
}

function dateKey(d: OrcidDate | null | undefined): [number, number, number] {
	return [Number(d?.year?.value ?? 0), Number(d?.month?.value ?? 0), Number(d?.day?.value ?? 0)];
}

function compareKeys(a: number[], b: number[]): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff) return diff;
	}
	return 0;
}

function latestYear(aff: Affiliation): number {
	return Math.max(0, ...(aff.years ?? []));
}

/** Newest first, for ISO-style date strings of any precision. */
function byDateDesc(a: string, b: string): number {
	return a < b ? 1 : a > b ? -1 : 0;
}

/** ORCID employments, newest start first. */
export function orcidJobs(record: OrcidRecord): OrcidJob[] {
	const groups = record['activities-summary']?.employments?.['affiliation-group'] ?? [];
	const jobs = groups.flatMap((g) => (g.summaries ?? []).map((s) => s['employment-summary']));
	return jobs.sort((a, b) => compareKeys(dateKey(b['start-date']), dateKey(a['start-date'])));
}

function isCurrentJob(job: OrcidJob): boolean {
	return !job['end-date'];
}

/** OpenAlex affiliations that name an institution, most recent year first. */
export function affiliations(author: Author): Affiliation[] {
	return (author.affiliations ?? []).filter((a) => a.institution)
		.sort((a, b) => latestYear(b) - latestYear(a));
}

/** OpenAlex's view of where someone works now: last known institutions, else the newest affiliation. */
function openAlexCurrent(author: Author): Institution[] {
	if (author.last_known_institutions?.length) return author.last_known_institutions;
	return affiliations(author).slice(0, 1).flatMap((a) => (a.institution ? [a.institution] : []));
}

/**
 * The city of an ORCID address, if it names one. Addresses are typed by the
 * person, and some put the state or province in the city field ("ON", "CA"):
 * then the institution's own location is used instead.
 */
export function orcidCity(address: { city?: string | null; region?: string | null } | null | undefined): string | undefined {
	const city = address?.city?.trim();
	if (!city) return undefined;
	const region = address?.region?.trim().toLowerCase();
	if (city.toLowerCase() === region || /^[A-Z]{2,3}$/.test(city)) return undefined;
	return city;
}

function fromJob(job: OrcidJob): RawPlace | null {
	const name = job.organization?.name;
	if (!name) return null;
	const addr = job.organization?.address;
	return { name, city: orcidCity(addr), countryCode: addr?.country ?? undefined };
}

function fromInstitution(inst: Institution): RawPlace | null {
	if (!inst.display_name) return null;
	return {
		name: inst.display_name,
		id: lastPart(inst.id),
		type: inst.type ?? undefined,
		countryCode: inst.country_code ?? undefined,
	};
}

/** Give ORCID places (names only) the OpenAlex ID of the same-named institution, so details can be looked up. */
function withOpenAlexIds(places: RawPlace[], author: Author): RawPlace[] {
	const byName = new Map<string, Institution>();
	for (const a of affiliations(author)) if (a.institution?.display_name) byName.set(a.institution.display_name.toLowerCase(), a.institution);
	for (const i of author.last_known_institutions ?? []) if (i.display_name) byName.set(i.display_name.toLowerCase(), i);
	return places.map((p) => {
		const inst = p.id ? undefined : byName.get(p.name.toLowerCase());
		return inst ? { ...p, id: lastPart(inst.id), type: inst.type ?? p.type, countryCode: p.countryCode ?? inst.country_code ?? undefined } : p;
	});
}

function uniquePlaces(places: (RawPlace | null)[]): RawPlace[] {
	const seen = new Set<string>();
	return places.filter((p): p is RawPlace => !!p && !seen.has(p.name.toLowerCase()) && !!seen.add(p.name.toLowerCase()));
}

/** Ended ORCID jobs and other OpenAlex affiliations, most recently held first. */
export function previousPlaces(jobs: OrcidJob[], author: Author, current: RawPlace[]): RawPlace[] {
	const skip = new Set(current.map((c) => c.name.toLowerCase()));
	// lowercased name -> [last year seen, first place seen]; ORCID comes first, so its spelling wins
	const latest = new Map<string, [number, RawPlace]>();
	const held: [RawPlace | null, number][] = [
		...jobs.filter((j) => !isCurrentJob(j)).map((j): [RawPlace | null, number] => [fromJob(j), dateKey(j['end-date'])[0]]),
		...affiliations(author).map((a): [RawPlace | null, number] => [a.institution ? fromInstitution(a.institution) : null, latestYear(a)]),
	];
	for (const [place, year] of held) {
		if (!place) continue;
		const key = place.name.toLowerCase();
		if (skip.has(key)) continue;
		const seen = latest.get(key);
		if (!seen) latest.set(key, [year, place]);
		else if (seen[0] < year) seen[0] = year;
	}
	const places = [...latest.values()].sort((a, b) => b[0] - a[0]).map(([, place]) => place);
	return withOpenAlexIds(places, author);
}

/**
 * Where someone works and worked, from one source so city and country agree:
 * ORCID jobs with no end date, else OpenAlex's last known institutions, else
 * their newest OpenAlex affiliation. Places carry OpenAlex IDs where known,
 * so their details (city, coordinates, type) can be looked up in a batch.
 */
export function rawProfile(author: Author, record: OrcidRecord): RawProfile {
	const jobs = orcidJobs(record);
	const currentJobs = jobs.filter(isCurrentJob);
	const fromOrcid = currentJobs.length > 0;
	const institutions = withOpenAlexIds(
		uniquePlaces(fromOrcid ? currentJobs.map(fromJob) : openAlexCurrent(author).map(fromInstitution)), author);
	const first = institutions[0];
	const links = orcidLinks(record);
	return {
		institutions,
		previous: previousPlaces(jobs, author, institutions),
		city: fromOrcid ? first?.city : undefined,
		countryCode: first?.countryCode,
		website: links.website,
		linkedin: links.linkedin,
		email: links.email,
		orcid: author.orcid ? lastPart(author.orcid) : undefined,
	};
}

/** Website, LinkedIn and public email from an ORCID record. */
export function orcidLinks(record: OrcidRecord): Profile {
	const person = record.person ?? {};
	const out: Profile = {};
	for (const u of person['researcher-urls']?.['researcher-url'] ?? []) {
		const url = u.url?.value ?? '';
		let host: string;
		try {
			host = new URL(url).hostname.toLowerCase();
		} catch {
			continue;
		}
		if (host.includes('linkedin.com')) out.linkedin ??= url;
		else if (!SOCIAL_HOSTS.some((s) => host.includes(s))) out.website ??= url;
	}
	const email = (person.emails?.email ?? []).map((e) => e.email).find(Boolean);
	if (email) out.email = email;
	return out;
}

/** The newest works on an ORCID record, shaped like OpenAlex ones. */
export function orcidWorks(record: OrcidRecord, orcid: string, limit: number): { total: number; works: Work[] } {
	const groups = record['activities-summary']?.works?.group ?? [];
	const works = groups.map((g): Work => {
		const s = g['work-summary']?.[0] ?? {};
		const d = s['publication-date'];
		const doi = (s['external-ids']?.['external-id'] ?? []).find((i) => i['external-id-type'] === 'doi');
		let url = s.url?.value || `https://orcid.org/${orcid}`;
		if (doi) url = doi['external-id-url']?.value || `https://doi.org/${doi['external-id-value'] ?? ''}`;
		return {
			title: (s.title?.title?.value || 'Untitled').trim(),
			date: [d?.year?.value, d?.month?.value, d?.day?.value].filter(Boolean).join('-'),
			url,
			venue: s['journal-title']?.value ?? '',
		};
	});
	works.sort((a, b) => byDateDesc(a.date, b.date));
	return { total: groups.length, works: works.slice(0, limit) };
}

/** Which found values to write: only into empty properties, unless refreshing locations. */
export function profileChanges(fm: Frontmatter, found: Profile, refresh: boolean): Profile {
	// City and country are a pair: a hand-typed one is never mixed with a looked-up one.
	const locationFree = refresh || LOCATION.every((k) => isEmpty(fm[k]));
	const changes: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(found)) {
		const write = (LOCATION as readonly string[]).includes(k) ? locationFree
			: isEmpty(fm[k]) || (refresh && (INSTITUTIONS as readonly string[]).includes(k));
		if (write && JSON.stringify(fm[k] ?? null) !== JSON.stringify(v)) changes[k] = v;
	}
	return changes;
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

/** What a place value shows: the alias or name of a link, else the text; lowercased, for comparing. */
function placeKey(v: unknown): string {
	if (typeof v !== 'string') return '';
	const m = v.match(/^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/);
	return (m ? (m[2] ?? m[1]?.split('/').pop() ?? '') : v).trim().toLowerCase();
}

/** A list with new values added, keeping every existing one (case-insensitively deduplicated). */
export function addToList(existing: unknown, add: string[]): unknown[] {
	const out = asList(existing).filter((v) => v !== null && v !== '');
	const seen = new Set(out.map(placeKey));
	for (const v of add) {
		if (!seen.has(placeKey(v))) {
			seen.add(placeKey(v));
			out.push(v);
		}
	}
	return out;
}

/**
 * When refreshing replaces someone's institutions, nothing is lost: places
 * that are no longer current, and every previous one, stay in
 * `previous_institutions`.
 */
export function keepOldPlaces(fm: Frontmatter, changes: Profile): Profile {
	if (!changes.institutions && !changes.previous_institutions) return changes;
	const current = changes.institutions ?? asList(fm.institutions).filter((v): v is string => typeof v === 'string');
	const isCurrent = new Set(current.map(placeKey));
	const previous = [...(changes.previous_institutions ?? []), ...asList(fm.institutions), ...asList(fm.previous_institutions)]
		.filter((v): v is string => typeof v === 'string' && !!v.trim() && !isCurrent.has(placeKey(v)));
	return { ...changes, previous_institutions: addToList([], previous) as string[] };
}
