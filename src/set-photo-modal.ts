import { type App, Modal } from 'obsidian';
import { type PhotoImage, PhotoPicker } from './photo-picker.ts';

/** Takes an image for a person's photo. */
export class SetPhotoModal extends Modal {
	private readonly name: string;
	private readonly onImage: (image: PhotoImage) => void;

	constructor(app: App, name: string, onImage: (image: PhotoImage) => void) {
		super(app);
		this.name = name;
		this.onImage = onImage;
	}

	onOpen(): void {
		this.setTitle(`Photo of ${this.name}`);
		const picker = new PhotoPicker(this.contentEl, (image) => {
			this.close();
			this.onImage(image);
		});
		this.modalEl.addEventListener('paste', (evt) => picker.handlePaste(evt));
		this.scope.register([], 'Enter', (evt) => {
			if (!picker.linkFocused()) return;
			evt.preventDefault();
			void picker.useLink();
		});
		window.setTimeout(() => this.contentEl.find('.scholar-atlas-photo-drop')?.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
