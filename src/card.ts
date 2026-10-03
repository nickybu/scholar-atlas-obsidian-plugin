/**
 * What a person's profile card shows, from their note's properties. Pure
 * functions, no Obsidian imports; card-view.ts draws it.
 */
import { photoEmbed } from './photo.ts';
import type { Frontmatter } from './types.ts';

const list = (v: unknown): string[] =>
	(Array.isArray(v) ? v : v == null ? [] : [v]).filter((x): x is string => typeof x === 'string' && !!x.trim());

/** Markdown for the card: the photo (if any) and the lines beside it. Property links stay links. */
export function cardMarkdown(fm: Frontmatter, photoWidth: number): { photo: string | null; details: string } {
	const lines: string[] = [];
	const where = list(fm.institutions).join(', ');
	const place = [...list(fm.city), ...list(fm.country)].join(', ');
	if (where || place) lines.push([where, place].filter(Boolean).join(' · '));
	const lab = list(fm.lab).join(', ');
	if (lab) lines.push(`**Lab** ${lab}`);
	const methods = list(fm.methods).slice(0, 4);
	if (methods.length) lines.push(`**Methods** ${methods.join(' · ')}`);
	const systems = list(fm.model_systems).slice(0, 4);
	if (systems.length) lines.push(`**Model systems** ${systems.join(' · ')}`);
	const events = list(fm.events);
	if (events.length) lines.push(`**Met at** ${events.join(', ')}`);
	return {
		photo: photoEmbed(fm.photo, photoWidth),
		details: lines.length ? lines.join('\n\n') : '_Run **Scholar Atlas: Update this person** to fill this in._',
	};
}
