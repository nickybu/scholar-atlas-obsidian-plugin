import { Notice, requestUrl, Setting } from 'obsidian';
import { imageExtension } from './photo.ts';

export interface PhotoImage {
	data: ArrayBuffer;
	/** File extension, e.g. `jpg`. */
	ext: string;
}

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Ways to give an image: paste it (anywhere in the dialog), drop it, choose a
 * file, or enter the image's address. Used by both Set photo and Add person.
 */
export class PhotoPicker {
	private readonly onImage: (image: PhotoImage) => void;
	private readonly fileInput: HTMLInputElement;
	private linkInput: HTMLInputElement | null = null;
	private link = '';

	constructor(containerEl: HTMLElement, onImage: (image: PhotoImage) => void) {
		this.onImage = onImage;
		const drop = containerEl.createDiv({
			cls: 'scholar-atlas-photo-drop',
			text: 'Paste an image, or drop one here.',
			attr: { tabindex: '0' },
		});
		drop.addEventListener('dragover', (evt) => {
			evt.preventDefault();
			drop.addClass('is-dragover');
		});
		drop.addEventListener('dragleave', () => drop.removeClass('is-dragover'));
		drop.addEventListener('drop', (evt) => {
			drop.removeClass('is-dragover');
			evt.preventDefault();
			void this.fromFiles(evt.dataTransfer?.files);
		});

		const fileInput = containerEl.createEl('input', {
			cls: 'scholar-atlas-hidden',
			attr: { type: 'file', accept: 'image/*' },
		});
		fileInput.addEventListener('change', () => void this.fromFiles(fileInput.files));
		this.fileInput = fileInput;
		new Setting(containerEl)
			.setName('From a file')
			.addButton((b) => b.setButtonText('Choose image').onClick(() => fileInput.click()));

		new Setting(containerEl)
			.setName('From a link')
			.setDesc('The address of the image itself: right-click the photo and copy the image address.')
			.addText((t) => {
				this.linkInput = t.inputEl;
				t.setPlaceholder('Image address').onChange((v) => { this.link = v.trim(); });
			})
			.addButton((b) => b.setButtonText('Use link').onClick(() => void this.useLink()));
	}

	/** Take a pasted image. Register on the whole dialog; pasted text is left alone. */
	handlePaste(evt: ClipboardEvent): void {
		const files = evt.clipboardData?.files;
		if (!files || !Array.from(files).some((f) => f.type.startsWith('image/'))) return;
		evt.preventDefault();
		void this.fromFiles(files);
	}

	/** Whether the link field has focus, so Enter should use the link rather than submit the dialog. */
	linkFocused(): boolean {
		return !!this.linkInput && this.linkInput === this.linkInput.doc.activeElement;
	}

	/** A link typed but not yet used. */
	pendingLink(): string {
		return this.link;
	}

	/** Download the image at the entered address; resolves to whether it worked. */
	async useLink(): Promise<boolean> {
		const url = this.link;
		if (!/^https?:\/\//i.test(url)) {
			new Notice('Enter a link starting with https://');
			return false;
		}
		let res;
		try {
			res = await requestUrl({ url, throw: false });
		} catch {
			new Notice('Couldn\'t download that link.');
			return false;
		}
		const mime = Object.entries(res.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
		const ext = imageExtension(mime, url);
		if (res.status !== 200 || !ext || (mime && !mime.startsWith('image/'))) {
			new Notice('That link isn\'t an image. Copy the image address, not the page address.');
			return false;
		}
		return this.accept({ data: res.arrayBuffer, ext });
	}

	private async fromFiles(files: FileList | null | undefined): Promise<void> {
		const file = Array.from(files ?? []).find((f) => f.type.startsWith('image/'));
		if (!file) {
			if (files?.length) new Notice('That isn\'t an image.');
			return;
		}
		const ext = imageExtension(file.type, file.name);
		if (!ext) {
			new Notice(`Obsidian can't show ${file.type} images.`);
			return;
		}
		this.accept({ data: await file.arrayBuffer(), ext });
	}

	private accept(image: PhotoImage): boolean {
		if (image.data.byteLength > MAX_BYTES) {
			new Notice('That image is over 20 MB. Pick a smaller one.');
			return false;
		}
		// Clear what was used, so the same file can be chosen again and a used link isn't fetched twice.
		this.fileInput.value = '';
		this.link = '';
		if (this.linkInput) this.linkInput.value = '';
		this.onImage(image);
		return true;
	}
}
