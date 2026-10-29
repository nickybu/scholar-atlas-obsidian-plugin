import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseFilter, matches, parseTags, selector, tagCompletions } from '../src/selector.ts';

test('tags are read from text however they are written', () => {
	assert.deepEqual(parseTags('#person, Scientist  lab/pi,,person'), ['person', 'scientist', 'lab/pi']);
	assert.deepEqual(parseTags(''), []);
});

test('notes are selected by folder, by tag (nested too), or both', () => {
	const folderOnly = selector('People/', '', 'any');
	assert.ok(matches(folderOnly, 'People/Ada.md', []));
	assert.ok(matches(folderOnly, 'People/Lab/Ada.md', []));
	assert.ok(!matches(folderOnly, 'PeopleX/Ada.md', []));

	const tagsOnly = selector('', 'person', 'any');
	assert.ok(matches(tagsOnly, 'Anywhere/Ada.md', ['#person']));
	assert.ok(matches(tagsOnly, 'Anywhere/Ada.md', ['#Person/PI']));
	assert.ok(!matches(tagsOnly, 'Anywhere/Ada.md', ['#personal']));

	const either = selector('People', 'person', 'any');
	assert.ok(matches(either, 'People/Ada.md', []));
	assert.ok(matches(either, 'Elsewhere/Ada.md', ['person']));
	const both = selector('People', 'person', 'all');
	assert.ok(!matches(both, 'People/Ada.md', []));
	assert.ok(matches(both, 'People/Ada.md', ['person']));

	assert.ok(!matches(selector('', '', 'any'), 'People/Ada.md', ['person']));
});

test('the same selection as a Bases filter', () => {
	assert.equal(baseFilter(selector('People', '', 'any')), 'file.inFolder("People")');
	assert.equal(baseFilter(selector('', 'person, pi', 'any')), 'file.hasTag("person", "pi")');
	assert.equal(baseFilter(selector('People', 'person', 'any')), '(file.inFolder("People") || file.hasTag("person"))');
	assert.equal(baseFilter(selector('People', 'person', 'all')), 'file.inFolder("People") && file.hasTag("person")');
});

test('tag suggestions complete the tag being typed, skipping ones already chosen', () => {
	const vault = ['person', 'person/pi', 'project', 'conference'];
	assert.deepEqual(tagCompletions(vault, 'per'), ['person', 'person/pi']);
	assert.deepEqual(tagCompletions(vault, 'person, #pro'), ['project']);
	assert.deepEqual(tagCompletions(vault, 'person, '), ['person/pi', 'project', 'conference']);
});
