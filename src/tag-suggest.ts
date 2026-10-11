import { AbstractInputSuggest, type App, getAllTags } from 'obsidian';
import { tagCompletions } from './selector.ts';

/**
 * Suggests the vault's tags for a comma-separated tags field, completing the
 * tag being typed. The vault's tags are gathered once, when first needed.
 */
export class TagSuggest extends AbstractInputSuggest<string> {
	private readonly input: HTMLInputElement;
	private tags: string[] | null = null;

	constructor(app: App, input: HTMLInputElement) {
		super(app, input);
		this.input = input;
		this.onSelect((tag) => {
			const done = this.getValue().split(',').slice(0, -1).map((t) => t.trim()).filter(Boolean);
			this.setValue([...done, tag].join(', ') + ', ');
			// Let the setting save the new value, as if it had been typed.
			this.input.dispatchEvent(new Event('input'));
			this.close();
		});
	}

	/** Every tag in the vault (without `#`), most used first. */
	private vaultTags(): string[] {
		if (!this.tags) {
			const counts = new Map<string, number>();
			for (const file of this.app.vault.getMarkdownFiles()) {
				const cache = this.app.metadataCache.getFileCache(file);
				for (const tag of new Set((cache ? getAllTags(cache) ?? [] : []).map((t) => t.replace(/^#/, '').toLowerCase()))) {
					counts.set(tag, (counts.get(tag) ?? 0) + 1);
				}
			}
			this.tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
		}
		return this.tags;
	}

	protected getSuggestions(query: string): string[] {
		return tagCompletions(this.vaultTags(), query);
	}

	renderSuggestion(tag: string, el: HTMLElement): void {
		el.setText(`#${tag}`);
	}
}
