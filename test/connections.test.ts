import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connections, nameKey, pendingTargets, renderConnections } from '../src/connections.ts';
import { countryCode, countryName } from '../src/countries.ts';
import type { WorkAuthor, WorkDetail } from '../src/types.ts';

const inst = (id: string, name: string, country = 'CH', type = 'education') =>
	({ id: `https://openalex.org/${id}`, display_name: name, country_code: country, type });
const author = (id: string, name: string, position: string, ...institutions: ReturnType<typeof inst>[]): WorkAuthor =>
	({ id, name, position, institutions });
const work = (...authors: WorkAuthor[]): WorkDetail => ({ year: 2025, authors, text: '', mesh: [] });

const me = author('A1', 'Ada Example', 'first', inst('I1', 'Home Uni'));

test('split profiles of one person count as one', () => {
	assert.equal(nameKey('Jorge F. Mejías'), nameKey('Mejias Jorge F.'));
	assert.notEqual(nameKey('Jorge Mejias'), nameKey('Jorge Martinez'));
});

test('co-authors, institutions, companies, countries and the PI come from the papers', () => {
	const pi1 = author('A9', 'Jorge F. Mejías', 'last', inst('I2', 'Lab Uni', 'NL'));
	const pi2 = author('A8', 'Mejias Jorge F.', 'last', inst('I2', 'Lab Uni', 'NL'));
	const works = [
		work(me, author('A3', 'Bo Collab', 'middle', inst('I4', 'Pharma AG', 'CH', 'company')), pi1),
		work(me, author('A3', 'Bo Collab', 'middle', inst('I1', 'Home Uni')), pi2),
		// My own split profile, with an umbrella organisation that should be ignored.
		work(author('A1', 'Ada Example', 'first'), author('A7', 'A. Example', 'middle'), author('A6', 'Cy Other', 'last', inst('I149899117', 'Max Planck Society', 'DE'))),
		// Someone else's paper isn't counted.
		work(author('A5', 'Not Me', 'first')),
	];
	const c = connections('A1', 'Ada Example', works);
	assert.equal(c.basis, 3);
	assert.deepEqual(c.coauthors.map((p) => [p.name, p.papers]), [['Bo Collab', 2], ['Jorge F. Mejías', 2], ['A. Example', 1], ['Cy Other', 1]]);
	assert.deepEqual(c.pi, { id: 'A9', name: 'Jorge F. Mejías', papers: 2 });
	assert.deepEqual(c.institutions, [{ id: 'I2', name: 'Lab Uni', papers: 2 }]); // Home Uni is their own
	assert.deepEqual(c.companies, [{ id: 'I4', name: 'Pharma AG', papers: 1 }]);
	assert.deepEqual(c.countries.map((p) => [p.name, p.papers]), [['Netherlands', 2], ['Switzerland', 2], ['Germany', 1]]);
});

test('consortium papers are left out, and a PI needs a clear majority', () => {
	const crowd = Array.from({ length: 60 }, (_, i) => author(`A${100 + i}`, `Person ${i}`, 'middle'));
	assert.equal(connections('A1', 'Ada Example', [work(me, ...crowd)]).basis, 0);
	const works = ['A2', 'A3', 'A4', 'A5'].map((id) => work(me, author(id, `PI ${id}`, 'last')));
	assert.equal(connections('A1', 'Ada Example', works).pi, null);
});

test('the block links everything and hides IDs for click-to-create', () => {
	const c = connections('A1', 'Ada Example', [work(me, author('A3', 'Bo Collab', 'last', inst('I2', 'Lab Uni', 'NL')))]);
	const block = renderConnections(c, {
		person: (p) => `[[People/${p.name}|${p.name}]]`,
		institution: (p) => `[[Places/Institutions/${p.name}|${p.name}]]`,
		country: (_code, name) => `[[Places/Countries/${name}|${name}]]`,
	});
	assert.match(block, /^\*From their latest 1 paper\*\n\n\*\*Co-authors\*\*\n- \[\[People\/Bo Collab\|Bo Collab\]\] · 1 paper %%A3%%/);
	assert.deepEqual([...pendingTargets(block)], [['People/Bo Collab', 'A3'], ['Places/Countries/Netherlands', 'NL']]);
	assert.match(renderConnections(connections('A1', 'Ada', []), { person: String, institution: String, country: String }), /No co-authors/);
});

test('country names and codes round-trip, with or without "The"', () => {
	assert.equal(countryName('ch'), 'Switzerland');
	assert.equal(countryCode('The Netherlands'), 'NL');
	assert.equal(countryCode('Switzerland'), 'CH');
	assert.equal(countryCode('Atlantis'), null);
});

test('of equally common spellings, the first-name-first one with accents wins', () => {
	const pi = (id: string, name: string) => author(id, name, 'last');
	const c = connections('A1', 'Ada Example', [work(me, pi('A8', 'Mejias Jorge F.')), work(me, pi('A9', 'Jorge F. Mejías'))]);
	assert.equal(c.pi?.name, 'Jorge F. Mejías');
});
