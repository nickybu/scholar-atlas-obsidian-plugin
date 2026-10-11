import { AbstractInputSuggest, type App, Modal, Notice, Setting, type TFile } from 'obsidian';
import { matchOpenAlex, matchOrcid } from './profile.ts';
import { type PhotoImage, PhotoPicker } from './photo-picker.ts';
import type { NewPerson } from './people.ts';

/** Suggests event notes for the "Met at" field. */
class EventSuggest extends AbstractInputSuggest<TFile> {
	private readonly events: TFile[];

	constructor(app: App, inputEl: HTMLInputElement, events: TFile[]) {
		super(app, inputEl);
		this.events = events;
	}

	getSuggestions(query: string): TFile[] {
		const q = query.trim().toLowerCase();
		return this.events.filter((f) => f.basename.toLowerCase().includes(q)).slice(0, 20);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.basename);
	}
}

/** Asks for a name and, optionally, IDs, where you met and a photo. */
export class AddPersonModal extends Modal {
	private readonly events: () => TFile[];
	private readonly onSubmit: (person: NewPerson) => void;
	private previewUrl = '';

	constructor(app: App, events: () => TFile[], onSubmit: (person: NewPerson) => void) {
		super(app);
		this.events = events;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		const input = { name: '', orcid: '', openalex: '', event: '' };
		let photo: PhotoImage | null = null;
		this.setTitle('Add person');

		new Setting(contentEl)
			.setName('Name')
			.setDesc('Their full name, accents included. It becomes the note title.')
			.addText((t) => {
				t.onChange((v) => { input.name = v; });
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		new Setting(contentEl)
			.setName('ORCID')
			.setDesc('Optional. The ID or the orcid.org link.')
			.addText((t) => t.setPlaceholder('0000-0001-2345-6789').onChange((v) => { input.orcid = v; }));
		new Setting(contentEl)
			.setName('OpenAlex ID')
			.setDesc('Optional. The ID or the openalex.org link.')
			.addText((t) => t.setPlaceholder('A5012345678').onChange((v) => { input.openalex = v; }));
		new Setting(contentEl)
			.setName('Met at')
			.setDesc('Optional. An event note, added to their events.')
			.addText((t) => {
				t.onChange((v) => { input.event = v; });
				// Listed once per dialog rather than on every keystroke.
				const suggest = new EventSuggest(this.app, t.inputEl, this.events());
				suggest.onSelect((file) => {
					suggest.setValue(file.basename);
					input.event = file.basename;
					suggest.close();
				});
			});

		new Setting(contentEl).setName('Photo').setDesc('Optional.').setHeading();
		const preview = contentEl.createDiv({ cls: ['scholar-atlas-photo-preview', 'scholar-atlas-hidden'] });
		const pickerEl = contentEl.createDiv();
		const picker = new PhotoPicker(pickerEl, (image) => {
			photo = image;
			this.showPreview(preview, pickerEl, image, () => { photo = null; });
		});
		this.modalEl.addEventListener('paste', (evt) => picker.handlePaste(evt));

		let submitting = false;
		const submit = async () => {
			if (submitting) return;
			submitting = true;
			try {
				await validateAndSubmit();
			} finally {
				submitting = false;
			}
		};
		const validateAndSubmit = async () => {
			const name = input.name.trim().replace(/\s+/g, ' ');
			const orcid = matchOrcid(input.orcid);
			const openalex = matchOpenAlex(input.openalex);
			if (!name) {
				new Notice('A name is required.');
			} else if (/[\\/:*?"<>|#^[\]]/.test(name)) {
				new Notice('A name can\'t contain \\ / : * ? " < > | # ^ [ ]');
			} else if (input.orcid.trim() && !orcid) {
				new Notice('That doesn\'t look like an ORCID (0000-0000-0000-0000).');
			} else if (input.openalex.trim() && !openalex) {
				new Notice('That doesn\'t look like an OpenAlex author ID, e.g. A5012345678.');
			} else if (!photo && picker.pendingLink() && !(await picker.useLink())) {
				// A photo link was entered but couldn't be used; the picker said why.
			} else {
				this.close();
				this.onSubmit({ name, orcid, openalex, event: input.event.trim(), photo });
			}
		};
		new Setting(contentEl).addButton((b) => b.setButtonText('Add').setCta().onClick(() => void submit()));
		this.scope.register([], 'Enter', (evt) => {
			evt.preventDefault();
			if (picker.linkFocused()) void picker.useLink();
			else void submit();
		});
	}

	/** Swap the picker for a thumbnail of the chosen photo, with a way back. */
	private showPreview(preview: HTMLElement, pickerEl: HTMLElement, image: PhotoImage, onRemove: () => void): void {
		this.revokePreview();
		this.previewUrl = URL.createObjectURL(new Blob([image.data]));
		preview.empty();
		preview.createEl('img', { attr: { src: this.previewUrl, alt: 'Chosen photo' } });
		new Setting(preview).addButton((b) => b.setButtonText('Remove photo').onClick(() => {
			onRemove();
			this.revokePreview();
			preview.empty();
			preview.addClass('scholar-atlas-hidden');
			pickerEl.removeClass('scholar-atlas-hidden');
		}));
		preview.removeClass('scholar-atlas-hidden');
		pickerEl.addClass('scholar-atlas-hidden');
	}

	private revokePreview(): void {
		if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
		this.previewUrl = '';
	}

	onClose(): void {
		this.revokePreview();
		this.contentEl.empty();
	}
}
