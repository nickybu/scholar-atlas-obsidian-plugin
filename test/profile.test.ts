import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	matchOpenAlex, matchOrcid, orcidJobs, orcidLinks, orcidWorks, previousPlaces, profileChanges, rawProfile, unique,
} from '../src/profile.ts';
import type { Author, OrcidJob, OrcidRecord } from '../src/types.ts';

const date = (year: string, month = '01') => ({ year: { value: year }, month: { value: month } });

function job(name: string, start: string, end?: string, city = 'Testville', country = 'CH'): OrcidJob {
	return {
		organization: { name, address: { city, country } },
		'start-date': date(start),
		'end-date': end ? date(end) : null,
	};
}

function record(jobs: OrcidJob[], extra: OrcidRecord = {}): OrcidRecord {
	return {
		...extra,
		'activities-summary': {
			...extra['activities-summary'],
			employments: { 'affiliation-group': jobs.map((j) => ({ summaries: [{ 'employment-summary': j }] })) },
		},
	};
}

test('IDs are found in bare values and links', () => {
	assert.equal(matchOrcid('https://orcid.org/0000-0002-1825-009x'), '0000-0002-1825-009X');
	assert.equal(matchOrcid('nope'), '');
	assert.equal(matchOrcid(42), '');
	assert.equal(matchOpenAlex('https://openalex.org/A5012345678'), 'A5012345678');
	assert.equal(matchOpenAlex('none'), '');
});

test('unique drops blanks and case-insensitive duplicates', () => {
	assert.deepEqual(unique(['Uni A', null, 'uni a', '', 'Uni B']), ['Uni A', 'Uni B']);
});

test('ORCID jobs are sorted newest first', () => {
	const jobs = orcidJobs(record([job('Old', '2010', '2014'), job('Now', '2020'), job('Mid', '2015', '2019')]));
	assert.deepEqual(jobs.map((j) => j.organization?.name), ['Now', 'Mid', 'Old']);
});

test('previous institutions merge ORCID and OpenAlex, skip current ones, newest first', () => {
	const jobs = orcidJobs(record([job('Now Uni', '2020'), job('Postdoc Uni', '2016', '2020')]));
	const author: Author = {
		affiliations: [
			{ institution: { id: 'I1', display_name: 'Now Uni' }, years: [2024, 2021] },
			{ institution: { id: 'I2', display_name: 'postdoc uni' }, years: [2023, 2017] },
			{ institution: { id: 'I3', display_name: 'PhD Uni' }, years: [2014, 2012] },
		],
	};
	// "Postdoc Uni" keeps its latest year (2023, from a paper) and its first-seen spelling.
	const previous = previousPlaces(jobs, author, [{ name: 'Now Uni' }]);
	assert.deepEqual(previous.map((p) => p.name), ['Postdoc Uni', 'PhD Uni']);
	// The ORCID job picks up the OpenAlex ID of the same institution, for looking up its details.
	assert.deepEqual(previous.map((p) => p.id), ['I2', 'I3']);
	assert.equal(previous[0]?.city, 'Testville');
});

test('ORCID links: social profiles skipped, LinkedIn and email picked out', () => {
	const links = orcidLinks({
		person: {
			'researcher-urls': {
				'researcher-url': [
					{ url: { value: 'https://bsky.app/profile/someone' } },
					{ url: { value: 'https://www.linkedin.com/in/someone' } },
					{ url: { value: 'not a url' } },
					{ url: { value: 'https://lab.example.edu/someone' } },
				],
			},
			emails: { email: [{ email: 'someone@example.edu' }] },
		},
	});
	assert.deepEqual(links, {
		linkedin: 'https://www.linkedin.com/in/someone',
		website: 'https://lab.example.edu/someone',
		email: 'someone@example.edu',
	});
});

test('ORCID works: DOI links, partial dates, newest first, limited', () => {
	const rec: OrcidRecord = {
		'activities-summary': {
			works: {
				group: [
					{ 'work-summary': [{ title: { title: { value: 'Old paper' } }, 'publication-date': { year: { value: '2015' } } }] },
					{
						'work-summary': [{
							title: { title: { value: ' New paper ' } },
							'publication-date': date('2024', '05'),
							'external-ids': { 'external-id': [{ 'external-id-type': 'doi', 'external-id-value': '10.1/x' }] },
							'journal-title': { value: 'Journal' },
						}],
					},
					{ 'work-summary': [{ title: { title: { value: 'Middle' } }, 'publication-date': { year: { value: '2020' } } }] },
				],
			},
		},
	};
	const { total, works } = orcidWorks(rec, '0000-0002-1825-0097', 2);
	assert.equal(total, 3);
	assert.deepEqual(works, [
		{ title: 'New paper', date: '2024-05', url: 'https://doi.org/10.1/x', venue: 'Journal' },
		{ title: 'Middle', date: '2020', url: 'https://orcid.org/0000-0002-1825-0097', venue: '' },
	]);
});

test('profile changes only fill empty properties', () => {
	const fm = { city: null, country: '', institutions: ['Typed Uni'], website: '' };
	const found = { city: 'Basel', country: 'Switzerland', institutions: ['Found Uni'], website: 'https://x.org' };
	assert.deepEqual(profileChanges(fm, found, false), { city: 'Basel', country: 'Switzerland', website: 'https://x.org' });
});

test('a hand-typed city blocks the looked-up pair', () => {
	const changes = profileChanges({ city: 'Lisbon', country: null }, { city: 'Basel', country: 'Switzerland' }, false);
	assert.deepEqual(changes, {});
});

test('refreshing overwrites location and institution lists, but nothing else', () => {
	const fm = { city: 'Lisbon', country: 'Portugal', institutions: ['Old'], previous_institutions: [], website: 'mine' };
	const found = {
		city: 'Basel', country: 'Switzerland', institutions: ['New'], previous_institutions: ['Old'], website: 'theirs',
	};
	assert.deepEqual(profileChanges(fm, found, true), {
		city: 'Basel', country: 'Switzerland', institutions: ['New'], previous_institutions: ['Old'],
	});
});

test('unchanged values are not rewritten', () => {
	assert.deepEqual(profileChanges({ city: 'Basel', country: 'Switzerland' }, { city: 'Basel', country: 'Switzerland' }, true), {});
});

test('a raw profile takes city and country from the current ORCID job, else leaves the city to OpenAlex', () => {
	const author: Author = {
		orcid: 'https://orcid.org/0000-0002-1825-0097',
		last_known_institutions: [{ id: 'https://openalex.org/I9', display_name: 'Open Uni', country_code: 'NO', type: 'education' }],
	};
	const withJob = rawProfile(author, record([job('Now Uni', '2020', undefined, 'Basel', 'CH')]));
	assert.deepEqual([withJob.institutions.map((p) => p.name), withJob.city, withJob.countryCode], [['Now Uni'], 'Basel', 'CH']);
	assert.equal(withJob.orcid, '0000-0002-1825-0097');
	const noJob = rawProfile(author, {});
	assert.deepEqual(noJob.institutions, [{ name: 'Open Uni', id: 'I9', type: 'education', countryCode: 'NO' }]);
	assert.equal(noJob.city, undefined);
});
