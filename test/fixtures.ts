/**
 * Made-up researchers and the OpenAlex and ORCID responses for them. No real
 * people: names, IDs and institutions are invented.
 */
import type { FakeResponse, Network } from './fake-obsidian.ts';

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
export const RECENT = daysAgo(10);

export const ORCIDS = {
	ada: '0000-0002-0000-0001',
	ben: '0000-0002-0000-0002',
	cy: '0000-0002-0000-0003',
};

const INSTITUTIONS: Record<string, { name: string; type: string; city: string; country: string; lat: number; lon: number }> = {
	I1: { name: 'Example University', type: 'education', city: 'Lakeside', country: 'CH', lat: 47.5, lon: 7.6 },
	I2: { name: 'Harbor College', type: 'education', city: 'Harborview', country: 'NO', lat: 60.4, lon: 5.3 },
	I3: { name: 'Old Institute', type: 'facility', city: 'Oldtown', country: 'DE', lat: 52.5, lon: 13.4 },
	I4: { name: 'Pharma AG', type: 'company', city: 'Zug', country: 'CH', lat: 47.2, lon: 8.5 },
};

const inst = (id: string) => {
	const i = INSTITUTIONS[id]!;
	return { id: `https://openalex.org/${id}`, display_name: i.name, country_code: i.country, type: i.type };
};

const AUTHORS = [
	{
		id: 'https://openalex.org/A100',
		display_name: 'Ada Example',
		works_count: 2,
		orcid: `https://orcid.org/${ORCIDS.ada}`,
		last_known_institutions: [inst('I1')],
		affiliations: [
			{ institution: inst('I1'), years: [2026, 2021] },
			{ institution: inst('I3'), years: [2018] },
		],
	},
	{
		id: 'https://openalex.org/A200',
		display_name: 'Ben Sample',
		works_count: 1,
		orcid: `https://orcid.org/${ORCIDS.ben}`,
		last_known_institutions: [inst('I2')],
		affiliations: [{ institution: inst('I2'), years: [2025] }],
	},
	// Ada's PI, at a company; no note in the vault until someone clicks her name.
	{
		id: 'https://openalex.org/A300',
		display_name: 'Pia Leader',
		works_count: 2,
		orcid: null as unknown as string,
		last_known_institutions: [inst('I4')],
		affiliations: [{ institution: inst('I4'), years: [2026] }],
	},
];


const by = (id: string, name: string, position: string, ...institutions: string[]) =>
	({ author_position: position, author: { id: `https://openalex.org/${id}`, display_name: name }, institutions: institutions.map(inst) });
const abstract = (text: string) => Object.fromEntries(text.split(' ').map((w, i) => [w, [i]]));

const W1 = {
	id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1/recent', title: 'A recent finding', publication_date: RECENT,
	publication_year: Number(RECENT.slice(0, 4)), primary_location: { source: { display_name: 'Journal of Examples' } },
	authorships: [by('A100', 'Ada Example', 'first', 'I1'), by('A200', 'Ben Sample', 'middle', 'I2'), by('A300', 'Pia Leader', 'last', 'I4')],
	abstract_inverted_index: abstract('We used two-photon imaging in awake mice'), mesh: [],
};
const W2 = {
	id: 'https://openalex.org/W2', doi: null, title: 'An older result', publication_date: '2019-05-01', publication_year: 2019,
	primary_location: null, authorships: [by('A100', 'Ada Example', 'first', 'I1'), by('A300', 'Pia Leader', 'last', 'I4')],
	abstract_inverted_index: null, mesh: [{ descriptor_name: 'Mice' }],
};
const W3 = {
	id: 'https://openalex.org/W3', doi: null, title: 'Harbor studies', publication_date: '2024-02-02', publication_year: 2024,
	primary_location: null, authorships: [by('A200', 'Ben Sample', 'first', 'I2'), by('A100', 'Ada Example', 'last', 'I1')],
	abstract_inverted_index: null, mesh: [],
};

const WORKS: Record<string, object[]> = { A100: [W1, W2], A200: [W3], A300: [W1, W2] };

const date = (y: string, m = '01') => ({ year: { value: y }, month: { value: m }, day: null });
const job = (name: string, city: string, country: string, start: string, end?: string) => ({
	summaries: [{
		'employment-summary': {
			organization: { name, address: { city, country } },
			'start-date': date(start),
			'end-date': end ? date(end) : null,
		},
	}],
});

const ORCID_RECORDS: Record<string, object> = {
	[ORCIDS.ada]: {
		person: {
			'researcher-urls': { 'researcher-url': [
				{ url: { value: 'https://ada.example.org' } },
				{ url: { value: 'https://www.linkedin.com/in/ada-example' } },
			] },
			emails: { email: [] },
		},
		'activities-summary': {
			employments: { 'affiliation-group': [
				job('Example University', 'Lakeside', 'CH', '2020'),
				job('Old Institute', 'Oldtown', 'DE', '2015', '2019'),
			] },
			works: { group: [] },
		},
	},
	// Ben has an ORCID record but no jobs on it, so his location comes from OpenAlex.
	[ORCIDS.ben]: { person: {}, 'activities-summary': { employments: { 'affiliation-group': [] }, works: { group: [] } } },
	// Cy isn't on OpenAlex: profile and papers come from ORCID alone.
	[ORCIDS.cy]: {
		person: { 'researcher-urls': { 'researcher-url': [{ url: { value: 'https://bsky.app/profile/cy' } }] } },
		'activities-summary': {
			employments: { 'affiliation-group': [job('Fjord Lab', 'Bergen', 'NO', '2023')] },
			works: { group: [
				{ 'work-summary': [{ title: { title: { value: 'Cy\'s preprint' } }, 'publication-date': { year: { value: RECENT.slice(0, 4) }, month: { value: RECENT.slice(5, 7) }, day: { value: RECENT.slice(8, 10) } }, 'external-ids': { 'external-id': [{ 'external-id-type': 'doi', 'external-id-value': '10.2/cy' }] } }] },
			] },
		},
	},
};

const CANDIDATES = [
	{ id: 'https://openalex.org/A900', display_name: 'Dee Unknown', orcid: null, works_count: 3, last_known_institutions: [inst('I3')] },
];

const ok = (json: unknown): FakeResponse => ({ status: 200, json });
const NOT_FOUND: FakeResponse = { status: 404 };

/** Answers OpenAlex and ORCID requests from the data above. */
export const scholarlyApis: Network = (url) => {
	const u = new URL(url);
	if (u.hostname === 'pub.orcid.org') {
		const orcid = u.pathname.split('/')[2] ?? '';
		return ORCID_RECORDS[orcid] ? ok(ORCID_RECORDS[orcid]) : NOT_FOUND;
	}
	if (u.hostname !== 'api.openalex.org') return NOT_FOUND;
	const [, entity, id] = u.pathname.split('/');
	const filter = u.searchParams.get('filter') ?? '';
	const values = filter.slice(filter.indexOf(':') + 1).split('|');
	const short = (x: { id: string }) => x.id.split('/').pop() ?? '';
	switch (entity) {
		case 'authors': {
			if (id?.startsWith('orcid:')) {
				const a = AUTHORS.find((x) => x.orcid?.endsWith(id.slice(6)));
				return a ? ok(a) : NOT_FOUND;
			}
			if (id) {
				const a = AUTHORS.find((x) => short(x) === id);
				return a ? ok(a) : NOT_FOUND;
			}
			if (filter.startsWith('orcid:')) return ok({ results: AUTHORS.filter((a) => a.orcid && values.some((v) => a.orcid.endsWith(v))) });
			if (filter.startsWith('openalex:')) return ok({ results: AUTHORS.filter((a) => values.includes(short(a))) });
			if (u.searchParams.get('search')) return ok({ results: CANDIDATES });
			return NOT_FOUND;
		}
		case 'institutions': {
			const detail = (i: string) => {
				const x = INSTITUTIONS[i]!;
				return {
					id: `https://openalex.org/${i}`, display_name: x.name, type: x.type, ror: `https://ror.org/0${i.toLowerCase()}`,
					geo: { city: x.city, country_code: x.country, latitude: x.lat, longitude: x.lon },
				};
			};
			if (id) return INSTITUTIONS[id] ? ok(detail(id)) : NOT_FOUND;
			return ok({ results: values.filter((v) => INSTITUTIONS[v]).map(detail) });
		}
		case 'works':
			return ok({ results: WORKS[values[0] ?? ''] ?? [] });
		default:
			return NOT_FOUND;
	}
};

export const note = (props: string) => `---\nphoto:\nevents: []\ncity:\ncountry:\ninstitutions: []\nprevious_institutions: []\nlab:\n${props}\nwebsite:\nemail:\nlinkedin:\n---\n## Notes\n\n\n## Papers\n<!-- papers:start -->\n<!-- papers:end -->\n`;

/** A vault with one person for each path through the plugin. */
export const VAULT: Record<string, string> = {
	'People/Ada Example.md': note(`orcid: ${ORCIDS.ada}\nopenalex: A100`),
	'People/Ben Sample.md': note(`orcid: ${ORCIDS.ben}\nopenalex:`),
	'People/Cy Orcidonly.md': note(`orcid: ${ORCIDS.cy}\nopenalex:`),
	'People/Dee Unknown.md': note('orcid:\nopenalex:'),
	'People/Eve None.md': note('orcid:\nopenalex: none'),
	'Events/Example Conference 2026.md': '---\ncity: Lakeside\n---\n',
	'Templates/Person.md': note('orcid:\nopenalex:'),
};
