import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	blockPapers, END, getBlock, isCandidateList, paperLine, renderCandidates, renderFeed, renderWorks, setBlock, START, worksSummary,
} from '../src/papers.ts';
import { sign } from '../src/managed.ts';

const work = { title: 'A [bracketed] <i>title</i> | piped', date: '2026-03-31', url: 'https://doi.org/10.1/a(b)', venue: 'J' };

test('paper lines escape markdown and encode parentheses in links', () => {
	assert.equal(paperLine(work), '- 2026-03-31 · [A \\[bracketed\\] title \\| piped](https://doi.org/10.1/a%28b%29) · *J*');
	assert.equal(paperLine({ ...work, date: '', venue: '' }).slice(0, 9), '- n.d. · ');
});

test('works block has a source header and a fallback when empty', () => {
	assert.match(renderWorks('[OpenAlex](https://openalex.org/A1)', 29, [work]), /^\*From \[OpenAlex\].* · 29 works in total\*\n\n- 2026/);
	assert.match(renderWorks('[ORCID](x)', undefined, []), /No papers found yet/);
});

test('candidates list IDs, ORCID and institutions', () => {
	const out = renderCandidates([{
		id: 'https://openalex.org/A1', display_name: 'Ada Example', orcid: 'https://orcid.org/0000-0002-1825-0097',
		works_count: 3, last_known_institutions: [{ id: 'I1', display_name: 'Example Uni' }],
	}]);
	assert.match(out, /> - `A1` · \[Ada Example\]\(https:\/\/openalex\.org\/A1\) · ORCID 0000-0002-1825-0097 · Example Uni · 3 works/);
	assert.match(renderCandidates([]), /No matches found by name/);
});

test('setBlock replaces only the marked block (signed), or appends one', () => {
	// "old" isn't in the plugin's format, so it's taken to be yours and kept just below.
	const note = `---\na: 1\n---\nmy notes\n${START}\nold\n${END}\nmore notes\n`;
	assert.equal(setBlock(note, 'new\n'), `---\na: 1\n---\nmy notes\n${START}\n${sign('new\n')}${END}\nold\nmore notes\n`);
	assert.equal(setBlock('just notes\n\n', 'x\n'), `just notes\n\n## Papers\n${START}\n${sign('x\n')}${END}\n`);
});

test('blockPapers reads dated lines inside the block only', () => {
	const note = `- 2026-01-01 · [outside](u)\n${START}\n*From x*\n\n- 2026-03-31 · [in](u) · *J*\n- n.d. · [undated](u)\n- 2024 · [year](u)\n${END}\n`;
	assert.deepEqual(blockPapers(note), [['2026-03-31', '[in](u) · *J*'], ['2024', '[year](u)']]);
});

test('feed is sorted newest first and links people', () => {
	const out = renderFeed([['2026-01-02', 'Bo', '[b](u)'], ['2026-03-04', 'Ada', '[a](u)']], 90);
	assert.match(out, /^Papers from the last 90 days/);
	assert.ok(out.indexOf('[[Ada]]') < out.indexOf('[[Bo]]'));
	assert.match(renderFeed([], 30), /Nothing new in this window/);
});

test('a paper shared by several people is listed once', () => {
	const out = renderFeed([['2026-03-04', 'Bo', '[p](u)'], ['2026-03-04', 'Ada', '[p](u)'], ['2026-03-04', 'Ada', '[q](u)']], 90);
	assert.match(out, /^- 2026-03-04 · \[\[Ada\]\], \[\[Bo\]\] · \[p\]\(u\)$/m);
	assert.match(out, /^- 2026-03-04 · \[\[Ada\]\] · \[q\]\(u\)$/m);
	assert.equal(out.match(/\[p\]/g)?.length, 1);
});

test('an existing papers block can be read back', () => {
	const block = renderWorks('[OpenAlex](https://openalex.org/A1)', 29, [work, { ...work, title: 'b' }]);
	const note = setBlock('---\na: 1\n---\n', block);
	assert.equal(getBlock(note), block);
	assert.equal(setBlock(note, getBlock(note) ?? ''), note);
	assert.deepEqual(worksSummary(block), { source: 'https://openalex.org/A1', count: 29, listed: 2 });
	assert.deepEqual(worksSummary(renderWorks('[ORCID](https://orcid.org/x)', undefined, [])), { source: 'https://orcid.org/x', count: null, listed: 0 });
	assert.equal(worksSummary(renderCandidates([])), null);
	assert.ok(isCandidateList(renderCandidates([])));
	assert.equal(getBlock('no markers'), null);
});
