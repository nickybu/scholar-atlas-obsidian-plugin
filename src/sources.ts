/** Lookups against the OpenAlex and ORCID public APIs. */
import { requestUrl } from 'obsidian';
import type { Author, Candidate, InstitutionDetail, Institution, OrcidRecord, Work, WorkDetail } from './types.ts';
import { lastPart, matchOrcid, unique } from './profile.ts';

const OPENALEX_API = 'https://api.openalex.org';
const ORCID_API = 'https://pub.orcid.org/v3.0';
const AUTHOR_FIELDS = 'id,display_name,works_count,orcid,last_known_institutions,affiliations';
/**
 * How many of a person's latest papers are fetched. Notes list fewer (the
 * papers setting); the rest feed collaborators, their PI and research tags,
 * all from this one request.
 */
export const WORKS_WINDOW = 50;
/** OpenAlex accepts at most 100 values in one `a|b|c` filter. */
const BATCH_SIZE = 100;
/** Waits between attempts: two retries, then the service counts as unreachable. */
const RETRY_WAITS = [1000, 3000];
const MAX_RETRY_AFTER = 60_000;
/**
 * Minimum gap between requests to each service, to stay under their rate
 * limits however many people are updated at once: OpenAlex allows 10 a
 * second, ORCID's public API 24.
 */
const MIN_GAP = { OpenAlex: 125, ORCID: 50 };

export interface SourceOptions {
	/** Contact address for OpenAlex's polite pool; empty for none. */
	mailto: string;
	apiKey: string;
	papersPerPerson: number;
	/** Override the waits between retries (tests). */
	retryWaits?: number[];
	/** Space requests out to respect rate limits; on unless turned off (tests). */
	throttle?: boolean;
}

/** A service can't be reached. Stop the run: every other request would fail the same way. */
export class NetworkError extends Error {}

/** A request that will never succeed as made, such as a rejected API key. Also stops the run. */
export class RequestError extends Error {}

/** One malformed request: fails that person, not the whole run. */
class BadRequestError extends Error {}

/**
 * One instance per run. Identical requests are only made once, and
 * {@link prefetch} fills in many people's OpenAlex records in a few batched
 * requests, so the per-person lookups after it are answered from memory.
 */
export class Sources {
	private readonly cache = new Map<string, Promise<unknown>>();
	/** When each service may next be called. */
	private readonly nextSlot = new Map<keyof typeof MIN_GAP, number>();
	/** OpenAlex author records by ID; `{}` for IDs OpenAlex doesn't know. */
	private readonly authors = new Map<string, Author>();
	/** OpenAlex author ID for each ORCID; `''` when OpenAlex doesn't know the ORCID. */
	private readonly byOrcid = new Map<string, string>();
	/** Institution details by OpenAlex institution ID; null for IDs OpenAlex doesn't know. */
	private readonly institutionDetails = new Map<string, InstitutionDetail | null>();

	private readonly options: SourceOptions;

	constructor(options: SourceOptions) {
		this.options = options;
	}

	/**
	 * GET JSON, retrying briefly; null when the record doesn't exist. Responses
	 * several people may share are kept for the run; one-off ones (`share:
	 * false`) aren't, so a big run doesn't hold every ORCID record in memory.
	 */
	private async fetchJson<T>(url: string, headers: Record<string, string> = {}, share = true): Promise<T | null> {
		if (!share) return (await this.fetchWithRetry(url, headers)) as T | null;
		let pending = this.cache.get(url);
		if (!pending) {
			pending = this.fetchWithRetry(url, headers);
			this.cache.set(url, pending);
		}
		try {
			return (await pending) as T | null;
		} catch (e) {
			this.cache.delete(url);
			throw e;
		}
	}

	private async fetchWithRetry(url: string, headers: Record<string, string>): Promise<unknown> {
		const service: keyof typeof MIN_GAP = url.startsWith(ORCID_API) ? 'ORCID' : 'OpenAlex';
		const waits = this.options.retryWaits ?? RETRY_WAITS;
		let lastErr = '';
		for (let attempt = 0; ; attempt++) {
			let wait = waits[attempt];
			try {
				await this.throttle(service);
				const r = await requestUrl({ url, headers, throw: false });
				if (r.status === 200) return r.json as unknown;
				if ([404, 409, 410].includes(r.status)) return null; // missing, locked or deprecated
				if ((r.status === 401 || r.status === 403) && service === 'OpenAlex' && this.options.apiKey) {
					throw new RequestError('OpenAlex rejected the API key. Check it in Scholar Atlas settings.');
				}
				if (r.status === 401 || r.status === 403) {
					throw new RequestError(`${service} refused a request (HTTP ${r.status}).`);
				}
				if (r.status === 400) throw new BadRequestError(`${service} couldn't handle a request (HTTP 400).`);
				if (r.status === 429) wait = retryAfter(r.headers, wait);
				lastErr = `HTTP ${r.status}`;
			} catch (e) {
				if (e instanceof RequestError || e instanceof BadRequestError) throw e;
				lastErr = e instanceof Error ? e.message : String(e);
			}
			if (wait === undefined) {
				if (lastErr === 'HTTP 429') throw new NetworkError(`${service} is limiting requests. Wait a minute and try again.`);
				if (/^HTTP 5/.test(lastErr)) throw new NetworkError(`${service} isn't responding (${lastErr}). Try again later.`);
				throw new NetworkError(`Couldn't reach ${service} (${lastErr}). Check your internet connection and try again.`);
			}
			await sleep(wait);
		}
	}

	/** Wait for this service's next free slot. */
	private async throttle(service: keyof typeof MIN_GAP): Promise<void> {
		if (this.options.throttle === false) return;
		const now = Date.now();
		const slot = Math.max(now, this.nextSlot.get(service) ?? 0);
		this.nextSlot.set(service, slot + MIN_GAP[service]);
		if (slot > now) await sleep(slot - now);
	}

	private openalex<T>(path: string, params: Record<string, string | number> = {}, share = true): Promise<T | null> {
		const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
		// Polite pool: a contact address gets faster, more reliable service.
		if (this.options.mailto) q.set('mailto', this.options.mailto);
		if (this.options.apiKey) q.set('api_key', this.options.apiKey);
		return this.fetchJson<T>(`${OPENALEX_API}/${path}?${q.toString()}`, {}, share);
	}

	/** Every result of an OpenAlex `key:a|b|c` filter, 100 values per request. */
	private async batch<T>(entity: string, key: string, values: string[], select: string): Promise<T[]> {
		const out: T[] = [];
		for (let i = 0; i < values.length; i += BATCH_SIZE) {
			const chunk = values.slice(i, i + BATCH_SIZE);
			const d = await this.openalex<{ results?: T[] }>(entity, {
				filter: `${key}:${chunk.join('|')}`,
				select,
				per_page: 200,
			});
			out.push(...(d?.results ?? []));
		}
		return out;
	}

	/**
	 * Fetch OpenAlex records for many people at once: authors by OpenAlex ID,
	 * and by ORCID for people with no OpenAlex ID yet.
	 */
	async prefetch(openAlexIds: string[], orcids: string[]): Promise<void> {
		// By ORCID first: these come back as whole author records, so their IDs needn't be fetched again.
		const newOrcids = unique(orcids).filter((o) => !this.byOrcid.has(o));
		const found = await this.batch<Author & { id: string }>('authors', 'orcid', newOrcids, AUTHOR_FIELDS);
		for (const o of newOrcids) this.byOrcid.set(o, '');
		for (const a of found) {
			const id = lastPart(a.id);
			this.authors.set(id, a);
			const o = matchOrcid(a.orcid);
			const current = this.authors.get(this.byOrcid.get(o) ?? '');
			// OpenAlex sometimes splits a person into several profiles: keep the biggest.
			if (o && (!current || (current.works_count ?? 0) < (a.works_count ?? 0))) this.byOrcid.set(o, id);
		}

		const newIds = unique(openAlexIds).filter((id) => !this.authors.has(id));
		for (const id of newIds) this.authors.set(id, {});
		for (const a of await this.batch<Author & { id: string }>('authors', 'openalex', newIds, AUTHOR_FIELDS)) {
			this.authors.set(lastPart(a.id), a);
		}
	}

	/** Details of many institutions (type, city, coordinates), 100 per request. */
	async institutions(ids: string[]): Promise<Map<string, InstitutionDetail>> {
		const wanted = unique(ids.map(lastPart));
		const missing = wanted.filter((id) => !this.institutionDetails.has(id));
		for (const id of missing) this.institutionDetails.set(id, null);
		const found = await this.batch<OpenAlexInstitution>('institutions', 'openalex', missing, 'id,display_name,type,ror,geo');
		for (const i of found) {
			this.institutionDetails.set(lastPart(i.id), {
				id: lastPart(i.id),
				name: i.display_name ?? '',
				type: i.type ?? undefined,
				ror: i.ror ? lastPart(i.ror) : undefined,
				city: i.geo?.city ?? undefined,
				countryCode: i.geo?.country_code ?? undefined,
				lat: i.geo?.latitude ?? undefined,
				lon: i.geo?.longitude ?? undefined,
			});
		}
		const out = new Map<string, InstitutionDetail>();
		for (const id of wanted) {
			const d = this.institutionDetails.get(id);
			if (d) out.set(id, d);
		}
		return out;
	}

	async authorFromOrcid(orcid: string): Promise<string> {
		const known = this.byOrcid.get(orcid);
		if (known !== undefined) return known;
		const d = await this.openalex<{ id: string }>(`authors/orcid:${orcid}`, { select: 'id' });
		return d ? lastPart(d.id) : '';
	}

	async author(aid: string): Promise<Author> {
		const known = this.authors.get(aid);
		if (known) return known;
		return (await this.openalex<Author>(`authors/${aid}`, { select: AUTHOR_FIELDS })) ?? {};
	}

	async orcidRecord(orcid: string): Promise<OrcidRecord> {
		return (await this.fetchJson<OrcidRecord>(`${ORCID_API}/${orcid}/record`, { Accept: 'application/json' }, false)) ?? {};
	}

	/**
	 * A person's latest papers: the newest few for their note, and up to
	 * {@link WORKS_WINDOW} with authors, abstracts and MeSH terms for
	 * collaborators and research tags. One request.
	 */
	async works(aid: string): Promise<{ works: Work[]; details: WorkDetail[] }> {
		const d = await this.openalex<{ results?: OpenAlexWork[] }>('works', {
			filter: `author.id:${aid}`,
			sort: 'publication_date:desc',
			per_page: Math.max(this.options.papersPerPerson, WORKS_WINDOW),
			select: 'id,doi,title,publication_date,publication_year,primary_location,authorships,abstract_inverted_index,mesh',
		}, false);
		const results = d?.results ?? [];
		return {
			works: results.slice(0, this.options.papersPerPerson).map((w) => ({
				title: (w.title || 'Untitled').trim(),
				date: w.publication_date ?? '',
				url: w.doi || w.id,
				venue: w.primary_location?.source?.display_name ?? '',
			})),
			details: results.map((w) => ({
				year: w.publication_year ?? 0,
				authors: (w.authorships ?? []).flatMap((a) => (a.author?.id ? [{
					id: lastPart(a.author.id),
					name: a.author.display_name ?? '',
					position: a.author_position ?? '',
					institutions: a.institutions ?? [],
				}] : [])),
				text: `${w.title ?? ''} ${abstractText(w.abstract_inverted_index)}`,
				mesh: unique((w.mesh ?? []).map((m) => m.descriptor_name)),
			})),
		};
	}

	/** The three closest OpenAlex authors by name, those at `institution` first. */
	async candidates(name: string, institution: string): Promise<Candidate[]> {
		const plain = name.normalize('NFKD').replace(/[̀-ͯ]/g, '');
		const d = await this.openalex<{ results?: Candidate[] }>('authors', {
			search: plain,
			per_page: 10,
			select: 'id,display_name,orcid,works_count,last_known_institutions',
		});
		const results = d?.results ?? [];
		if (institution) { // stable sort: institution matches first, OpenAlex order otherwise
			const inst = institution.toLowerCase();
			const hit = (a: Candidate) => (a.last_known_institutions ?? [])
				.some((i) => (i.display_name ?? '').toLowerCase().includes(inst));
			results.sort((a, b) => Number(hit(b)) - Number(hit(a)));
		}
		return results.slice(0, 3);
	}
}

interface OpenAlexWork {
	id: string;
	doi?: string | null;
	title?: string | null;
	publication_date?: string | null;
	publication_year?: number | null;
	primary_location?: { source?: { display_name?: string | null } | null } | null;
	authorships?: {
		author_position?: string;
		author?: { id?: string | null; display_name?: string | null } | null;
		institutions?: Institution[];
	}[];
	abstract_inverted_index?: Record<string, number[]> | null;
	mesh?: { descriptor_name: string }[];
}

interface OpenAlexInstitution {
	id: string;
	display_name?: string | null;
	type?: string | null;
	ror?: string | null;
	geo?: { city?: string | null; country_code?: string | null; latitude?: number | null; longitude?: number | null } | null;
}

/** OpenAlex stores abstracts as word -> positions; put the words back in order. */
export function abstractText(index: Record<string, number[]> | null | undefined): string {
	if (!index) return '';
	const words: string[] = [];
	for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
	return words.filter(Boolean).join(' ');
}

/** How long a 429 response asks us to wait (seconds or an HTTP date), capped; else the default. */
function retryAfter(headers: Record<string, string>, fallback: number | undefined): number | undefined {
	if (fallback === undefined) return undefined; // out of retries
	const value = Object.entries(headers).find(([k]) => k.toLowerCase() === 'retry-after')?.[1];
	if (!value) return fallback;
	const ms = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
	return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER) : fallback;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
