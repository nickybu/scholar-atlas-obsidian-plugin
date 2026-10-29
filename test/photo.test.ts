import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CARD, CARD_END, CARD_START, imageExtension, PHOTO_END, PHOTO_START, photoEmbed, scaledSize, setTopBlock, withCard,
} from '../src/photo.ts';
import { sign } from '../src/managed.ts';

const setPhotoBlock = (text: string, embed: string | null) => setTopBlock(text, PHOTO_START, PHOTO_END, embed);

test('image extensions come from the MIME type, else the name or URL', () => {
	assert.equal(imageExtension('image/jpeg'), 'jpg');
	assert.equal(imageExtension('image/png; charset=binary'), 'png');
	assert.equal(imageExtension('', 'Ada.JPEG'), 'jpg');
	assert.equal(imageExtension('application/octet-stream', 'https://x.org/a/face.webp?size=2'), 'webp');
	assert.equal(imageExtension('text/html', 'https://x.org/profile'), null);
	assert.equal(imageExtension('', 'notes.pdf'), null);
});

test('photo embeds accept wikilinks, paths and URLs', () => {
	assert.equal(photoEmbed('[[People/photos/Ada.jpg]]', 200), '![[People/photos/Ada.jpg|200]]');
	assert.equal(photoEmbed('![[Ada.jpg|old alias]]', 150), '![[Ada.jpg|150]]');
	assert.equal(photoEmbed(['[[Ada.png]]'], 200), '![[Ada.png|200]]');
	assert.equal(photoEmbed('photos/Ada.jpg', 200), '![[photos/Ada.jpg|200]]');
	assert.equal(photoEmbed('https://x.org/a b(1).jpg', 200), '![photo|200](https://x.org/a%20b%281%29.jpg)');
	assert.equal(photoEmbed('', 200), null);
	assert.equal(photoEmbed(null, 200), null);
	assert.equal(photoEmbed(42, 200), null);
});

test('a top block goes right after the properties', () => {
	const note = '---\nphoto: x\n---\n## Notes\n';
	const block = (x: string) => `${PHOTO_START}\n${sign(`${x}\n`)}${PHOTO_END}\n`;
	assert.equal(setPhotoBlock(note, '![[x|200]]'), `---\nphoto: x\n---\n${block('![[x|200]]')}## Notes\n`);
	assert.equal(setPhotoBlock('## Notes\n', '![[x|200]]'), `${block('![[x|200]]')}## Notes\n`);
});

test('a top block is replaced in place, or removed', () => {
	const note = `---\na: 1\n---\n${PHOTO_START}\n![[old|200]]\n${PHOTO_END}\n## Notes\n`;
	assert.equal(setPhotoBlock(note, '![[new|200]]'), `---\na: 1\n---\n${PHOTO_START}\n${sign('![[new|200]]\n')}${PHOTO_END}\n## Notes\n`);
	assert.equal(setPhotoBlock(note, null), '---\na: 1\n---\n## Notes\n');
	assert.equal(setPhotoBlock('---\na: 1\n---\n## Notes\n', null), '---\na: 1\n---\n## Notes\n');
});

test('photos are scaled to fit, keeping their shape', () => {
	assert.deepEqual(scaledSize(4000, 3000, 512), { width: 512, height: 384 });
	assert.deepEqual(scaledSize(1000, 2000, 512), { width: 256, height: 512 });
	assert.equal(scaledSize(512, 300, 512), null);
	assert.equal(scaledSize(0, 0, 512), null);
});

test('a note gets a card at the top, replacing an old photo block', () => {
	const old = `---\na: 1\n---\n${PHOTO_START}\n![[x|200]]\n${PHOTO_END}\n## Notes\n`;
	const carded = `---\na: 1\n---\n${CARD_START}\n${sign(`${CARD}\n`)}${CARD_END}\n## Notes\n`;
	assert.equal(withCard(old), carded);
	assert.equal(withCard(carded), carded);
});
