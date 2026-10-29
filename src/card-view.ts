import { type App, MarkdownRenderChild, MarkdownRenderer, TFile } from 'obsidian';
import { cardMarkdown } from './card.ts';

/**
 * Draws a person's profile card where their note has a `scholar-atlas` code
 * block, from the note's current properties, and redraws it when they change.
 * Nothing is written to the note.
 */
export class ProfileCard extends MarkdownRenderChild {
	private readonly app: App;
	private readonly sourcePath: string;
	private readonly photoWidth: () => number;
	/** Which draw is the latest; earlier ones still rendering stop, so quick edits don't leave two cards. */
	private drawn = 0;

	constructor(app: App, containerEl: HTMLElement, sourcePath: string, photoWidth: () => number) {
		super(containerEl);
		this.app = app;
		this.sourcePath = sourcePath;
		this.photoWidth = photoWidth;
	}

	onload(): void {
		void this.draw();
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (file.path === this.sourcePath) void this.draw();
		}));
	}

	private async draw(): Promise<void> {
		const n = ++this.drawn;
		const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
		const fm = (file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined) ?? {};
		const { photo, details } = cardMarkdown(fm, this.photoWidth());
		const card = createDiv({ cls: 'scholar-atlas-card' });
		if (photo) await MarkdownRenderer.render(this.app, photo, card.createDiv({ cls: 'scholar-atlas-card-photo' }), this.sourcePath, this);
		await MarkdownRenderer.render(this.app, details, card.createDiv({ cls: 'scholar-atlas-card-details' }), this.sourcePath, this);
		if (n !== this.drawn) return;
		this.containerEl.empty();
		this.containerEl.appendChild(card);
	}
}
