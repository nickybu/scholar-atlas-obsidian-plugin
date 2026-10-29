/** The parts of OpenAlex and ORCID records this plugin reads. */

export interface Work {
	title: string;
	/** `YYYY-MM-DD`, or as much of it as is known; empty if undated. */
	date: string;
	url: string;
	venue: string;
}

export interface Institution {
	id: string;
	display_name?: string | null;
	country_code?: string | null;
	type?: string | null;
	ror?: string | null;
}

/** A place someone works or worked, before it becomes a link to a place note. */
export interface RawPlace {
	name: string;
	/** OpenAlex institution ID (`I…`), when known. */
	id?: string;
	/** OpenAlex institution type: education, company, facility… */
	type?: string;
	city?: string;
	/** ISO 3166 code, e.g. `CH`. */
	countryCode?: string;
}

/** What OpenAlex's /institutions knows about one institution. */
export interface InstitutionDetail {
	id: string;
	name: string;
	type?: string;
	ror?: string;
	city?: string;
	countryCode?: string;
	lat?: number;
	lon?: number;
}

/** Where someone works and worked, and their links, before places become note links. */
export interface RawProfile {
	institutions: RawPlace[];
	previous: RawPlace[];
	/** City of the first current institution, when the source gives it directly (ORCID). */
	city?: string;
	countryCode?: string;
	website?: string;
	linkedin?: string;
	email?: string;
	orcid?: string;
}

/** One author on a paper, as far as collaborators are concerned. */
export interface WorkAuthor {
	id: string;
	name: string;
	position: string;
	institutions: Institution[];
}

/** A paper with what's needed for collaborators and research tags. */
export interface WorkDetail {
	year: number;
	authors: WorkAuthor[];
	/** Title and abstract. */
	text: string;
	mesh: string[];
}

export interface Affiliation {
	institution?: Institution | null;
	years?: number[];
}

export interface Author {
	id?: string;
	display_name?: string;
	works_count?: number;
	orcid?: string | null;
	last_known_institutions?: Institution[] | null;
	affiliations?: Affiliation[];
}

export interface Candidate {
	id: string;
	display_name: string;
	orcid?: string | null;
	works_count?: number;
	last_known_institutions?: Institution[] | null;
}

interface OrcidValue {
	value?: string | null;
}

export interface OrcidDate {
	year?: OrcidValue | null;
	month?: OrcidValue | null;
	day?: OrcidValue | null;
}

export interface OrcidJob {
	organization?: {
		name?: string | null;
		address?: { city?: string | null; region?: string | null; country?: string | null } | null;
	} | null;
	'start-date'?: OrcidDate | null;
	'end-date'?: OrcidDate | null;
}

export interface OrcidWorkSummary {
	title?: { title?: OrcidValue | null } | null;
	'publication-date'?: OrcidDate | null;
	'external-ids'?: {
		'external-id'?: {
			'external-id-type'?: string;
			'external-id-value'?: string;
			'external-id-url'?: OrcidValue | null;
		}[];
	} | null;
	url?: OrcidValue | null;
	'journal-title'?: OrcidValue | null;
}

export interface OrcidRecord {
	person?: {
		'researcher-urls'?: { 'researcher-url'?: { url?: OrcidValue | null }[] } | null;
		emails?: { email?: { email?: string | null }[] } | null;
	} | null;
	'activities-summary'?: {
		employments?: { 'affiliation-group'?: { summaries?: { 'employment-summary': OrcidJob }[] }[] } | null;
		works?: { group?: { 'work-summary'?: OrcidWorkSummary[] }[] } | null;
	} | null;
}

/** Property values found for a person; a key is present only when something was found. */
export interface Profile {
	institutions?: string[];
	previous_institutions?: string[];
	city?: string;
	country?: string;
	website?: string;
	linkedin?: string;
	email?: string;
	orcid?: string;
}

/** A person note's properties, as parsed from YAML. */
export type Frontmatter = Record<string, unknown>;
