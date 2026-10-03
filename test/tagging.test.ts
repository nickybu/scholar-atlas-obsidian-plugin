import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchTags, tagIds } from '../src/tagging.ts';
import { VOCAB } from '../src/vocab.ts';

test('the ported vocabulary passes neuro-labs-explorer\'s own probes', () => {
	// From the self-check at the bottom of pipeline/vocab.py.
	const probes: [string, string, boolean][] = [
		['pig', 'guinea pig cochlea', false], ['guinea_pig', 'guinea pig cochlea', true],
		['pig', 'porcine model', true], ['em_connectomics', 'cryo-electron microscopy structure', false],
		['structural_bio', 'cryo-electron microscopy structure', true],
		['tissue_clearing', 'for clarity, we', false], ['tissue_clearing', 'clarity-based clearing', true],
		['other_insects', 'participants performed', false],
		['other_insects', 'desert ants navigate', true], ['human_tissue', 'post-mortem brain tissue', true],
		['nt_sensors', 'we grab objects', false], ['nt_sensors', 'grab-da2m sensor', true],
		['rabbit', 'rabbit anti-gfap antibody', false], ['rabbit', 'rabbits were trained', true],
		['mouse', 'mouse monoclonal antibody against', false], ['mouse', 'in the mouse cortex', true],
		['chick', 'chicken anti-gfp', false], ['dog', 'madin-darby canine kidney cells', false],
		['fluid_biomarkers', 'cerebrospinal fluid dynamics in hydrocephalus', false],
		['fluid_biomarkers', 'csf p-tau181 levels', true],
		['rodent_behaviour', 'morris water maze', true], ['fluid_biomarkers', 'csf1r inhibition', false],
	];
	const ids = new Set(VOCAB.map((t) => t.id));
	for (const [id, text, want] of probes) {
		assert.ok(ids.has(id), `unknown tag ${id}`);
		assert.equal(tagIds(text).includes(id), want, `${id}: ${JSON.stringify(text)}`);
	}
});

test('no tag pattern uses lookbehind (unsupported on some iOS versions)', () => {
	for (const t of VOCAB) assert.ok(!t.pattern.includes('(?<') && !t.unless.includes('(?<'), t.id);
});

test('MeSH terms count as matches, and text is normalised', () => {
	assert.ok(tagIds('A study', ['Mice']).includes('mouse'));
	assert.ok(tagIds('Two–photon IMAGING in MICE').includes('mouse'));
});

test('research tags need two papers, or one if there are few', () => {
	const mice = { text: 'recordings in mice', mesh: [] };
	const rats = { text: 'recordings in rats', mesh: [] };
	assert.deepEqual(researchTags([mice, rats, mice]).modelSystems, ['Mouse']);
	assert.deepEqual(researchTags([mice, rats]).modelSystems.sort(), ['Mouse', 'Rat']);
	assert.deepEqual(researchTags([]), { methods: [], modelSystems: [] });
});
