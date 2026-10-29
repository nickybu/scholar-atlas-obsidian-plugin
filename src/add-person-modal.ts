import { AbstractInputSuggest, type App, Modal, Notice, Setting, type TextComponent, type TFile } from 'obsidian';
import { lastPart, matchOpenAlex, matchOrcid } from './profile.ts';
import { type PhotoImage, PhotoPicker } from './photo-picker.ts';
import { safeName } from './places.ts';
import type { NewPerson } from './people.ts';
import type { Candidate } from './types.ts';

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

export interface AddPersonOptions {
	/** Event notes to suggest for "Met at". */
	events: () => TFile[];
	/** OpenAlex authors matching a name, to pick from. */
	search: (name: string) => Promise<Candidate[]>;
	onSubmit: (person: NewPerson) => void;
}

/** How long after the last keystroke the name is looked up on OpenAlex. */
const SEARCH_DELAY = 600;
const MIN_SEARCH_LENGTH = 3;

/** Asks for a name and, optionally, IDs, where you met and a photo. */
export class AddPersonModal extends Modal {
	private readonly options: AddPersonOptions;
	private previewUrl = '';
	private searchTimer = 0;
	/** Which search is the latest; results of earlier ones are dropped. */
	private searched = 0;

	constructor(app: App, options: AddPersonOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		const input = { name: '', orcid: '', openalex: '', event: '' };
		let photo: PhotoImage | null = null;
		let orcidField: TextComponent | undefined;
		let openalexField: TextComponent | undefined;
		this.setTitle('Add person');

		new Setting(contentEl)
			.setName('Name')
			.setDesc('Their full name, accents included. It becomes the note title.')
			.addText((t) => {
				t.onChange((v) => {
					input.name = v;
					this.scheduleSearch(matches, v, () => !!matchOpenAlex(input.openalex), (c) => {
						input.openalex = lastPart(c.id);
						openalexField?.setValue(input.openalex);
						if (c.orcid && !input.orcid.trim()) {
							input.orcid = lastPart(c.orcid);
							orcidField?.setValue(input.orcid);
						}
					});
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});
		// Matches on OpenAlex for the name typed, with a button to use one.
		const matches = contentEl.createDiv({ cls: 'scholar-atlas-matches' });
		new Setting(contentEl)
			.setName('ORCID')
			.setDesc('Optional. The ID or the orcid.org link.')
			.addText((t) => {
				orcidField = t;
				t.setPlaceholder('0000-0001-2345-6789').onChange((v) => { input.orcid = v; });
			});
		new Setting(contentEl)
			.setName('OpenAlex ID')
			.setDesc('Optional. The ID or the openalex.org link. Without one, the note lists the closest matches to pick from.')
			.addText((t) => {
				openalexField = t;
				t.setPlaceholder('A5012345678').onChange((v) => { input.openalex = v; });
			});
		new Setting(contentEl)
			.setName('Met at')
			.setDesc('Optional. An event note, added to their events.')
			.addText((t) => {
				t.onChange((v) => { input.event = v; });
				// Listed once per dialog rather than on every keystroke.
				const suggest = new EventSuggest(this.app, t.inputEl, this.options.events());
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
			} else if (safeName(name) !== name) {
				new Notice('A name can\'t contain \\ / : * ? " < > | # ^ [ ] or end with a dot.');
			} else if (input.orcid.trim() && !orcid) {
				new Notice('That doesn\'t look like an ORCID (0000-0000-0000-0000).');
			} else if (input.openalex.trim() && !openalex) {
				new Notice('That doesn\'t look like an OpenAlex author ID, e.g. A5012345678.');
			} else if (!photo && picker.pendingLink() && !(await picker.useLink())) {
				// A photo link was entered but couldn't be used; the picker said why.
			} else {
				this.close();
				this.options.onSubmit({ name, orcid, openalex, event: input.event.trim(), photo });
			}
		};
		new Setting(contentEl).addButton((b) => b.setButtonText('Add').setCta().onClick(() => void submit()));
		this.scope.register([], 'Enter', (evt) => {
			evt.preventDefault();
			if (picker.linkFocused()) void picker.useLink();
			else void submit();
		});
	}

	/** Look the name up on OpenAlex once typing pauses, unless an ID is already given. */
	private scheduleSearch(el: HTMLElement, name: string, hasId: () => boolean, onPick: (c: Candidate) => void): void {
		window.clearTimeout(this.searchTimer);
		const query = name.trim().replace(/\s+/g, ' ');
		el.empty();
		if (query.length < MIN_SEARCH_LENGTH || hasId()) return;
		this.searchTimer = window.setTimeout(() => {
			const n = ++this.searched;
			el.setText('Looking for matches on OpenAlex…');
			this.options.search(query).then((found) => {
				if (n !== this.searched) return;
				this.showMatches(el, found, onPick);
			}, () => {
				if (n === this.searched) el.setText('OpenAlex can\'t be reached right now. Add them anyway: matches are suggested in the note later.');
			});
		}, SEARCH_DELAY);
	}

	private showMatches(el: HTMLElement, found: Candidate[], onPick: (c: Candidate) => void): void {
		el.empty();
		if (!found.length) {
			el.setText('No one by that name on OpenAlex. Add them anyway, with their ORCID if you have it.');
			return;
		}
		el.createDiv({ cls: 'scholar-atlas-matches-title', text: 'Is this them? Pick one to fill in their IDs.' });
		for (const c of found) {
			const where = (c.last_known_institutions ?? []).slice(0, 2).map((i) => i.display_name).filter(Boolean).join(', ');
			const bits = [where, `${c.works_count ?? 0} works`, c.orcid ? `ORCID ${lastPart(c.orcid)}` : ''].filter(Boolean);
			new Setting(el)
				.setName(c.display_name)
				.setDesc(bits.join(' · '))
				.addButton((b) => b.setButtonText('Use').onClick(() => {
					onPick(c);
					el.empty();
					el.setText(`Using ${c.display_name} (${lastPart(c.id)}).`);
				}));
		}
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
		window.clearTimeout(this.searchTimer);
		this.searched++;
		this.revokePreview();
		this.contentEl.empty();
	}
}
