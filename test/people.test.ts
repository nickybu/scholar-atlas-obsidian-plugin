import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import type { App, TFile } from 'obsidian';
import { createApp, FakeVault, type Network, requests, setNetwork } from './fake-obsidian.ts';
import { ORCIDS, RECENT, scholarlyApis, VAULT } from './fixtures.ts';
import { People } from '../src/people.ts';
import { defaultSettings, type ScholarAtlasSettings } from '../src/settings.ts';
import { CARD, CARD_START } from '../src/photo.ts';
import { linkName } from '../src/places.ts';

let vault: FakeVault;
/** Shared by every People in a test, like the plugin's saved settings. */
let settings: ScholarAtlasSettings;
let saves = 0;

function people(apiKey = ''): People {
	const app = createApp(vault) as unknown as App;
	return new People(app, settings, {
		apiKey: () => apiKey,
		save: async () => { saves++; },
		sources: { retryWaits: [0, 0], throttle: false },
	});
}

function props(path: string): Record<string, unknown> {
	const m = vault.text(path).match(/^---\n([\s\S]*?)---\n/);
	return YAML.parse(m?.[1] ?? '') as Record<string, unknown>;
}

/** Properties with links read as the names they show, e.g. `[[Places/Cities/Basel|Basel]]` -> `Basel`. */
function named(path: string): Record<string, unknown> {
	const read = (v: unknown): unknown => (Array.isArray(v) ? v.map(read) : typeof v === 'string' ? linkName(v) : v);
	return Object.fromEntries(Object.entries(props(path)).map(([k, v]) => [k, read(v)]));
}

const snapshot = () => new Map([...vault.files].map(([p, v]) => [p, typeof v === 'string' ? v : v.byteLength]));

beforeEach(() => {
	vault = new FakeVault(VAULT);
	settings = { ...defaultSettings(), feedFile: 'Feeds/Research.md' };
	saves = 0;
	setNetwork(scholarlyApis);
});

test('update all fills every kind of person', async () => {
	const result = await people().updateAll(false, () => {});
	assert.match(result, /^Updated 5 people; the research feed has 2 recent papers\./);

	// OpenAlex ID + ORCID: location from the current ORCID job, links from ORCID.
	assert.deepEqual(named('People/Ada Example.md'), {
		...named('People/Ada Example.md'),
		city: 'Lakeside', country: 'Switzerland',
		institutions: ['Example University'], previous_institutions: ['Old Institute'],
		website: 'https://ada.example.org', linkedin: 'https://www.linkedin.com/in/ada-example',
	});
	assert.match(vault.text('People/Ada Example.md'), /\*From \[OpenAlex\]\(https:\/\/openalex\.org\/A100\) · 2 works in total\*/);

	// ORCID only, found on OpenAlex: ID filled in, location from OpenAlex (no ORCID jobs).
	const ben = named('People/Ben Sample.md');
	assert.equal(ben.openalex, 'A200');
	assert.deepEqual([ben.city, ben.country, ben.institutions], ['Harborview', 'Norway', ['Harbor College']]);

	// ORCID not on OpenAlex: everything from ORCID, papers included.
	const cy = named('People/Cy Orcidonly.md');
	assert.deepEqual([cy.openalex, cy.city, cy.country], [null, 'Bergen', 'Norway']);
	assert.match(vault.text('People/Cy Orcidonly.md'), /\*From \[ORCID\][^\n]*\n\n- \d{4}-\d{2}-\d{2} · \[Cy's preprint\]\(https:\/\/doi\.org\/10\.2\/cy\)/);

	// No ID: suggestions. `none`: a note saying so.
	assert.match(vault.text('People/Dee Unknown.md'), /> - `A900` · \[Dee Unknown\]/);
	assert.match(vault.text('People/Eve None.md'), /_Not on OpenAlex or ORCID/);

	// The feed lands in a folder that didn't exist, newest first.
	const feed = vault.text('Feeds/Research.md');
	assert.match(feed, new RegExp(`- ${RECENT} · \\[\\[Ada Example\\]\\] · \\[A recent finding\\]`));
	assert.match(feed, /\[\[Cy Orcidonly\]\]/);
});

test('OpenAlex lookups are batched', async () => {
	await people().updateAll(false, () => {});
	const openalex = requests.filter((u) => u.startsWith('https://api.openalex.org/'));
	const path = (u: string) => new URL(u).pathname;
	// Authors and institution locations come from three batched requests, never one by one.
	assert.equal(openalex.filter((u) => /^\/(authors|institutions)\/./.test(path(u))).length, 0);
	assert.equal(openalex.filter((u) => /filter=(orcid|openalex)%3A/.test(u)).length, 3);
	// Authors by ORCID and by ID, and institution details: three batches. Plus works (Ada, Ben) and a name search (Dee).
	assert.equal(openalex.length, 3 + 2 + 1);
	assert.equal(requests.length - openalex.length, 3); // ORCID records: Ada, Ben, Cy
});

test('a second run changes nothing', async () => {
	await people().updateAll(false, () => {});
	const before = snapshot();
	await people().updateAll(false, () => {});
	assert.deepEqual(snapshot(), before);
});

test('typed locations are kept unless refreshing', async () => {
	await vault.process(vault.getFileByPath('People/Ada Example.md')!, (t) => t.replace('city:\n', 'city: Lisbon\n'));
	await people().updateAll(false, () => {});
	let ada = named('People/Ada Example.md');
	assert.deepEqual([ada.city, ada.country], ['Lisbon', null]);
	await people().updateAll(true, () => {});
	ada = named('People/Ada Example.md');
	assert.deepEqual([ada.city, ada.country], ['Lakeside', 'Switzerland']);
});

test('no internet: fails fast without touching notes', async () => {
	const before = snapshot();
	setNetwork(() => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); });
	await assert.rejects(people().updateAll(false, () => {}), /Couldn't reach OpenAlex/);
	assert.equal(requests.length, 3); // one batched request, tried three times
	assert.deepEqual(snapshot(), before);
});

test('one service down: the run stops instead of failing everyone slowly', async () => {
	setNetwork((url) => {
		if (url.startsWith('https://pub.orcid.org/')) throw new Error('timeout');
		return scholarlyApis(url);
	});
	const result = await people().updateAll(false, () => {});
	assert.match(result, /^Stopped after updating \d of 5 people\. Couldn't reach ORCID/);
	const orcidCalls = requests.filter((u) => u.startsWith('https://pub.orcid.org/'));
	assert.ok(orcidCalls.length <= 3 * 3, `${orcidCalls.length} ORCID requests`);
});

test('a rejected API key fails at once', async () => {
	setNetwork(() => ({ status: 403 }));
	await assert.rejects(people('wrong-key').updateAll(false, () => {}), (e: Error) => {
		assert.match(e.message, /OpenAlex rejected the API key/);
		assert.doesNotMatch(e.message, /wrong-key/);
		return true;
	});
	assert.equal(requests.length, 1);
});

test('rate limiting waits as asked, then carries on', async () => {
	let limited = false;
	const network: Network = (url) => {
		if (!limited) {
			limited = true;
			return { status: 429, headers: { 'Retry-After': '0' } };
		}
		return scholarlyApis(url);
	};
	setNetwork(network);
	assert.match(await people().updateAll(false, () => {}), /^Updated 5 people/);
});

test('add person with an event and a photo', async () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
	const result = await people().add({
		name: 'Fay New', orcid: '', openalex: '', event: 'example conference 2026', photo: { data: png, ext: 'png' },
	});
	assert.match(result, /^Fay New: no ID/);
	const fay = props('People/Fay New.md');
	assert.deepEqual(fay.events, ['[[Example Conference 2026]]']);
	assert.equal(fay.photo, '[[Fay New.png]]');
	assert.ok(vault.files.has('attachments/Fay New.png'));
	assert.ok(vault.text('People/Fay New.md').includes(`---\n${CARD_START}\n${CARD}\n`)); // the card shows the photo
});

test('adding someone who exists opens their note instead', async () => {
	const before = snapshot();
	const result = await people().add({ name: 'Ada Example', orcid: ORCIDS.ben, openalex: '', event: '', photo: null });
	assert.match(result, /already in your people folder/);
	assert.deepEqual(snapshot(), before);
});

test('an OpenAlex ID that doesn\'t exist is reported in the note', async () => {
	await vault.create('People/Gus Typo.md', VAULT['People/Dee Unknown.md']!.replace('openalex:\n', 'openalex: A999\n'));
	assert.match(await people().updateAll(false, () => {}), /^Updated 6 people/);
	assert.match(vault.text('People/Gus Typo.md'), /_OpenAlex has no author `A999`\. Check the `openalex` property\._/);
	assert.ok(!requests.some((u) => u.includes('author.id%3AA999')), 'no works lookup for a missing author');
});

test('one bad request fails that person only', async () => {
	setNetwork((url) => (url.includes('author.id%3AA100') ? { status: 400 } : scholarlyApis(url)));
	const result = await people().updateAll(false, () => {});
	assert.match(result, /^Updated 4 people; .* Failed: Ada Example \(details in the developer console\)\.$/);
	assert.equal(requests.filter((u) => u.includes('author.id%3AA100')).length, 1); // not retried
});

test('values typed while a lookup was running are kept', async () => {
	const p = people();
	// Type a city into Ada's note while her ORCID record is being fetched.
	setNetwork(async (url) => {
		if (url.startsWith('https://pub.orcid.org/')) {
			await vault.process(vault.getFileByPath('People/Ada Example.md')!, (t) => t.replace('city:\n', 'city: Lisbon\n'));
		}
		return scholarlyApis(url);
	});
	await p.updateOne(vault.getFileByPath('People/Ada Example.md') as unknown as TFile);
	const ada = named('People/Ada Example.md');
	assert.deepEqual([ada.city, ada.country], ['Lisbon', null]); // the pair isn't half-filled
	assert.equal(ada.website, 'https://ada.example.org'); // other properties still filled
});

test('a typed [[link]] in Met at isn\'t double-bracketed', async () => {
	await people().add({ name: 'Hal Link', orcid: '', openalex: '', event: '[[Example Conference 2026]]', photo: null });
	assert.deepEqual(props('People/Hal Link.md').events, ['[[Example Conference 2026]]']);
});

// --- repeat runs skip what can't have changed ----------------------------------

const kinds = () => ({
	works: requests.filter((u) => u.includes('/works?')).length,
	orcid: requests.filter((u) => u.startsWith('https://pub.orcid.org/')).length,
	search: requests.filter((u) => u.includes('search=')).length,
	total: requests.length,
});

test('a repeat run only makes the batched OpenAlex requests', async () => {
	const p = people();
	await p.updateAll(false, () => {});
	setNetwork(scholarlyApis);
	assert.match(await p.updateAll(false, () => {}), /^Updated 5 people/);
	// Authors by ORCID (Cy) and by ID; every institution already has a note.
	assert.deepEqual(kinds(), { works: 0, orcid: 0, search: 0, total: 2 });
	assert.ok(saves >= 2, 'ORCID check times are saved');
});

test('papers are fetched again when OpenAlex has more works', async () => {
	await people().updateAll(false, () => {});
	setNetwork(async (url) => {
		const r = await scholarlyApis(url);
		const bump = (a: { id?: string; works_count?: number }) => (a.id?.endsWith('/A100') ? { ...a, works_count: 3 } : a);
		const json = r.json as { results?: object[] } | undefined;
		return json?.results ? { ...r, json: { ...json, results: json.results.map(bump) } } : r;
	});
	await people().updateAll(false, () => {});
	assert.deepEqual(requests.filter((u) => u.includes('/works?')).map((u) => new URL(u).searchParams.get('filter')), ['author.id:A100']);
	assert.match(vault.text('People/Ada Example.md'), /· 3 works in total/);
});

test('an ORCID record is checked again once it\'s older than the setting', async () => {
	await people().updateAll(false, () => {});
	settings.orcidChecked[ORCIDS.ada] = Date.now() - 8 * 864e5;
	setNetwork(scholarlyApis);
	await people().updateAll(false, () => {});
	assert.deepEqual(requests.filter((u) => u.startsWith('https://pub.orcid.org/')), [`https://pub.orcid.org/v3.0/${ORCIDS.ada}/record`]);
	settings.orcidRecheckDays = 0;
	setNetwork(scholarlyApis);
	await people().updateAll(false, () => {});
	assert.equal(kinds().orcid, 3); // 0 days: every time
});

test('refreshing and updating one person look everything up again', async () => {
	await people().updateAll(false, () => {});
	setNetwork(scholarlyApis);
	await people().updateAll(true, () => {});
	assert.deepEqual({ ...kinds(), total: undefined }, { works: 2, orcid: 3, search: 1, total: undefined });
	setNetwork(scholarlyApis);
	await people().updateOne(vault.getFileByPath('People/Ada Example.md') as unknown as TFile);
	assert.deepEqual({ ...kinds(), total: undefined }, { works: 1, orcid: 1, search: 0, total: undefined });
});

test('check times for people who are gone are forgotten', async () => {
	await people().updateAll(false, () => {});
	assert.ok(settings.orcidChecked[ORCIDS.cy]);
	vault.files.delete('People/Cy Orcidonly.md');
	await people().updateAll(false, () => {});
	assert.equal(settings.orcidChecked[ORCIDS.cy], undefined);
	assert.ok(settings.orcidChecked[ORCIDS.ada]);
});

test('rebuilding the feed only re-reads notes that changed', async () => {
	const p = people();
	await p.updateAll(false, () => {});
	vault.reads.clear();
	await p.writeFeed();
	assert.equal(vault.reads.size, 0);
	await vault.process(vault.getFileByPath('People/Ben Sample.md')!, (t) => t.replace('## Notes', '## Notes\nMet for coffee.'));
	await p.writeFeed();
	assert.deepEqual([...vault.reads.keys()], ['People/Ben Sample.md']);
});

// --- only_update_papers --------------------------------------------------------

async function mark(path: string): Promise<void> {
	await vault.process(vault.getFileByPath(path)!, (t) => t.replace('---\n## Notes', 'only_update_papers: true\n---\n## Notes'));
}

test('marked people only get their papers updated, even when refreshing', async () => {
	await mark('People/Ada Example.md');
	for (const refresh of [false, true]) {
		setNetwork(scholarlyApis);
		await people().updateAll(refresh, () => {});
		assert.ok(!requests.some((u) => u.includes(ORCIDS.ada)), 'no ORCID request for Ada');
		const ada = named('People/Ada Example.md');
		assert.deepEqual([ada.city, ada.institutions, ada.website], [null, [], null]);
		assert.match(vault.text('People/Ada Example.md'), /\[A recent finding\]/);
	}
	// Everyone else is still filled in.
	assert.equal(named('People/Ben Sample.md').city, 'Harborview');
});

test('Update this person looks a marked person up anyway', async () => {
	await mark('People/Ada Example.md');
	await people().updateOne(vault.getFileByPath('People/Ada Example.md') as unknown as TFile);
	assert.ok(requests.some((u) => u.includes(ORCIDS.ada)));
	assert.equal(named('People/Ada Example.md').city, 'Lakeside');
});

test('a marked person who is only on ORCID still gets papers from it', async () => {
	await mark('People/Cy Orcidonly.md');
	await people().updateAll(false, () => {});
	assert.ok(requests.some((u) => u.includes(ORCIDS.cy)));
	assert.equal(named('People/Cy Orcidonly.md').city, null);
	assert.match(vault.text('People/Cy Orcidonly.md'), /\[Cy's preprint\]/);
});

// --- connections: places, collaborators, PI, research tags --------------------

test('places become linked notes, each listing its people', async () => {
	await people().updateAll(false, () => {});
	const ada = props('People/Ada Example.md');
	assert.equal(ada.city, '[[Places/Cities/Lakeside|Lakeside]]');
	assert.equal(ada.country, '[[Places/Countries/Switzerland|Switzerland]]');
	assert.deepEqual(ada.institutions, ['[[Places/Institutions/Example University|Example University]]']);
	assert.deepEqual(ada.previous_institutions, ['[[Places/Institutions/Old Institute|Old Institute]]']);

	const uni = props('Places/Institutions/Example University.md');
	assert.deepEqual([uni.type, uni.openalex, uni.city, uni.country, uni.location],
		['education', 'I1', '[[Places/Cities/Lakeside|Lakeside]]', '[[Places/Countries/Switzerland|Switzerland]]', [47.5, 7.6]]);
	assert.match(vault.text('Places/Institutions/Example University.md'), /```base\n[\s\S]*list\(institutions\)\.contains\(this\)/);
	assert.equal(props('Places/Cities/Lakeside.md').country, '[[Places/Countries/Switzerland|Switzerland]]');
	assert.equal(props('Places/Countries/Switzerland.md').country_code, 'CH');
	assert.equal(named('Places/Institutions/Old Institute.md').city, 'Oldtown'); // previous institutions are linked up too
});

test('collaborators, the likely PI and research tags come from the papers request', async () => {
	await people().updateAll(false, () => {});
	const text = vault.text('People/Ada Example.md');
	assert.match(text, /## Collaborators\n<!-- collaborators:start -->\n\*From their latest 2 papers\*/);
	assert.match(text, /- \[\[People\/Pia Leader\|Pia Leader\]\] · 2 papers %%A300%%/);
	assert.match(text, /- \[\[Ben Sample\]\] · 1 paper %%A200%%/); // has a note: linked to it
	assert.match(text, /\*\*Companies\*\*\n- \[\[Places\/Institutions\/Pharma AG\|Pharma AG\]\] · 2 papers %%I4%%/);
	assert.match(text, /\*\*Countries\*\*\n- \[\[Places\/Countries\/Switzerland\|Switzerland\]\] · 2 papers %%CH%%/);
	const ada = props('People/Ada Example.md');
	assert.equal(ada.lab, '[[People/Pia Leader|Pia Leader]]');
	assert.ok((ada.model_systems as string[]).includes('Mouse'));
	assert.ok((ada.methods as string[]).length > 0);
	assert.match(vault.text('People/Ben Sample.md'), /- \[\[Ada Example\]\] · 1 paper %%A100%%/);
});

test('clicking a collaborator with no note creates and fills it', async () => {
	const p = people();
	await p.updateAll(false, () => {});
	const pia = await vault.create('People/Pia Leader.md', '');
	assert.ok(await p.isPendingCreation(pia as unknown as TFile));
	assert.match(await p.created(pia as unknown as TFile) ?? '', /^Pia Leader:/);
	const props_ = named('People/Pia Leader.md');
	assert.deepEqual([props_.openalex, props_.institutions, props_.city], ['A300', ['Pharma AG'], 'Zug']);
	assert.match(vault.text('People/Pia Leader.md'), /- \[\[Ada Example\]\] · 2 papers %%A100%%/);

	// Any other new empty note is left alone.
	const other = await vault.create('People/Someone Else.md', '');
	assert.equal(await p.isPendingCreation(other as unknown as TFile), false);
	assert.equal(await p.created(other as unknown as TFile), null);
});

test('clicking a company or country with no note creates and fills it', async () => {
	const p = people();
	await p.updateAll(false, () => {});
	vault.files.delete('Places/Institutions/Pharma AG.md');
	const pharma = await vault.create('Places/Institutions/Pharma AG.md', '');
	await p.created(pharma as unknown as TFile);
	const company = named('Places/Institutions/Pharma AG.md');
	assert.deepEqual([company.type, company.city, company.country, company.openalex], ['company', 'Zug', 'Switzerland', 'I4']);
	assert.ok(vault.files.has('Places/Cities/Zug.md'));
});

test('places typed as text become links to place notes', async () => {
	await vault.process(vault.getFileByPath('People/Eve None.md')!, (t) => t
		.replace('city:\n', 'city: Paris\n').replace('country:\n', 'country: The Netherlands\n')
		.replace('institutions: []\nprevious', 'institutions:\n  - Sorbonne\nprevious'));
	await people().updateAll(false, () => {});
	const eve = props('People/Eve None.md');
	assert.deepEqual([eve.city, eve.country, eve.institutions], [
		'[[Places/Cities/Paris|Paris]]', '[[Places/Countries/Netherlands|Netherlands]]', ['[[Places/Institutions/Sorbonne|Sorbonne]]']]);
	assert.equal(props('Places/Countries/Netherlands.md').country_code, 'NL');
	assert.equal(props('Places/Cities/Paris.md').country, '[[Places/Countries/Netherlands|Netherlands]]');
	assert.ok(vault.files.has('Places/Institutions/Sorbonne.md'));
});

test('place notes you edited keep your values; only empty properties are filled', async () => {
	await vault.createFolder('Places/Cities');
	await vault.create('Places/Cities/Lakeside.md', '---\nlocation:\n  - 1\n  - 2\ncountry:\n---\nMy notes about Lakeside.\n');
	await people().updateAll(false, () => {});
	const lakeside = props('Places/Cities/Lakeside.md');
	assert.deepEqual(lakeside.location, [1, 2]);
	assert.equal(lakeside.country, '[[Places/Countries/Switzerland|Switzerland]]');
	assert.match(vault.text('Places/Cities/Lakeside.md'), /My notes about Lakeside\./);
});

test('institutions converted from text still get their details', async () => {
	await vault.process(vault.getFileByPath('People/Ada Example.md')!, (t) => t
		.replace('city:\n', 'city: Lakeside\n').replace('institutions: []\nprevious', 'institutions:\n  - Example University\nprevious'));
	await people().updateAll(false, () => {});
	const uni = named('Places/Institutions/Example University.md');
	assert.deepEqual([uni.openalex, uni.type, uni.city], ['I1', 'education', 'Lakeside']);
	assert.deepEqual(props('Places/Cities/Lakeside.md').location, [47.5, 7.6]);
});
