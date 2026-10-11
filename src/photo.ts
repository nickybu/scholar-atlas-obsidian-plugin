import { sign, unsigned, userLines } from './managed.ts';

/**
 * The person's photo, and the block at the top of their note that shows it
 * in their profile card. Pure functions, no Obsidian imports.
 */

/** The photo block earlier versions wrote; replaced by the card. */
export const PHOTO_START = '<!-- photo:start -->';
export const PHOTO_END = '<!-- photo:end -->';

export const CARD_START = '<!-- card:start -->';
export const CARD_END = '<!-- card:end -->';
/** A code block the plugin draws as the person's profile card, live from their properties. */
export const CARD = '```scholar-atlas\n```';

// Image formats Obsidian can display.
const EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
	'image/bmp': 'bmp',
	'image/svg+xml': 'svg',
};
const KNOWN_EXTENSIONS = new Set([...Object.values(EXTENSIONS), 'jpeg']);

/** The file extension for an image MIME type, or for a file name or URL path ending in one. */
export function imageExtension(mime: string, nameOrUrl = ''): string | null {
	const fromMime = EXTENSIONS[mime.split(';')[0]?.trim().toLowerCase() ?? ''];
	if (fromMime) return fromMime;
	let path = nameOrUrl;
	try {
		path = new URL(nameOrUrl).pathname;
	} catch {
		// a plain file name
	}
	const ext = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
	if (!ext || !KNOWN_EXTENSIONS.has(ext)) return null;
	return ext === 'jpeg' ? 'jpg' : ext;
}

/**
 * The embed to show for a `photo` property value, or null if there's no photo.
 * Accepts a wikilink (`[[photos/Ada.jpg]]`, with or without `!` or an alias),
 * a vault path, or a web URL.
 */
export function photoEmbed(photo: unknown, width: number): string | null {
	const value: unknown = Array.isArray(photo) ? (photo as unknown[])[0] : photo;
	if (typeof value !== 'string' || !value.trim()) return null;
	const v = value.trim();
	if (/^https?:\/\//i.test(v)) return `![photo|${width}](${v.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
	const target = (v.match(/^!?\[\[([^\]|]+)/)?.[1] ?? v).trim();
	return target ? `![[${target}|${width}]]` : null;
}

/**
 * Put a marked block right after the properties, replace it, or (for null)
 * remove it. Anything you wrote inside a block being replaced or removed is
 * kept, just below where it was.
 */
export function setTopBlock(text: string, start: string, end: string, content: string | null): string {
	const body = content === null ? null : `${content}\n`;
	const wrapped = body === null ? '' : `${start}\n${sign(body)}${end}\n`;
	const i = text.indexOf(start);
	const j = text.indexOf(end);
	if (i !== -1 && j > i) {
		const raw = text.slice(i + start.length + 1, j);
		if (body !== null && unsigned(raw) === body) return text;
		const kept = userLines(raw);
		let after = j + end.length;
		if (text[after] === '\n') after++;
		return text.slice(0, i) + wrapped + (kept.length ? `${kept.join('\n')}\n` : '') + text.slice(after);
	}
	if (!wrapped) return text;
	const at = text.match(/^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/)?.[0].length ?? 0;
	return text.slice(0, at) + wrapped + text.slice(at);
}

/** The size to scale an image down to so its longest side is `maxSide`, or null if it already fits. */
export function scaledSize(width: number, height: number, maxSide: number): { width: number; height: number } | null {
	const longest = Math.max(width, height);
	if (longest <= maxSide || longest <= 0) return null;
	const scale = maxSide / longest;
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Give a person note its card at the top, replacing the photo block of earlier versions. */
export function withCard(text: string): string {
	return setTopBlock(setTopBlock(text, PHOTO_START, PHOTO_END, null), CARD_START, CARD_END, CARD);
}
