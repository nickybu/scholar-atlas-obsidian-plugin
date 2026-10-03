import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardMarkdown } from '../src/card.ts';

test('the card shows where they are, their lab, research and where you met', () => {
	const card = cardMarkdown({
		photo: '[[Ada.jpg]]',
		institutions: ['[[Places/Institutions/Example University|Example University]]'],
		city: '[[Places/Cities/Lakeside|Lakeside]]',
		country: '[[Places/Countries/Switzerland|Switzerland]]',
		lab: '[[People/Pia Leader|Pia Leader]]',
		methods: ['Two-photon imaging', 'Electrophysiology', 'Optogenetics', 'Calcium imaging', 'One too many'],
		model_systems: ['Mouse'],
		events: ['[[Example Conference 2026]]'],
	}, 160);
	assert.equal(card.photo, '![[Ada.jpg|160]]');
	assert.equal(card.details, [
		'[[Places/Institutions/Example University|Example University]] · [[Places/Cities/Lakeside|Lakeside]], [[Places/Countries/Switzerland|Switzerland]]',
		'**Lab** [[People/Pia Leader|Pia Leader]]',
		'**Methods** Two-photon imaging · Electrophysiology · Optogenetics · Calcium imaging',
		'**Model systems** Mouse',
		'**Met at** [[Example Conference 2026]]',
	].join('\n\n'));
});

test('an empty card says how to fill it', () => {
	const card = cardMarkdown({ photo: null, institutions: [], lab: '' }, 200);
	assert.equal(card.photo, null);
	assert.match(card.details, /Update this person/);
});
