import { Notice, Plugin, TFile } from 'obsidian';
import { ProfileCard } from './card-view.ts';
import { AddPersonModal } from './add-person-modal.ts';
import { People } from './people.ts';
import { SetPhotoModal } from './set-photo-modal.ts';
import { defaultSettings, type ScholarAtlasSettings, ScholarAtlasSettingTab } from './settings.ts';

export default class ScholarAtlasPlugin extends Plugin {
	settings: ScholarAtlasSettings = defaultSettings();
	private people!: People;
	private busy = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.people = new People(this.app, this.settings, {
			apiKey: () => this.apiKey(),
			save: () => this.saveSettings(),
		});
		this.addSettingTab(new ScholarAtlasSettingTab(this));
		this.addRibbonIcon('user-plus', 'Add person', () => this.openAddPerson());

		this.addCommand({
			id: 'add-person',
			name: 'Add person',
			callback: () => this.openAddPerson(),
		});
		this.addCommand({
			id: 'update-person',
			name: 'Update this person',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.people.isPerson(file)) return false;
				if (!checking) void this.run(`Updating ${file.basename}…`, () => this.people.updateOne(file));
				return true;
			},
		});
		this.addCommand({
			id: 'set-photo',
			name: 'Set photo',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.people.isPerson(file)) return false;
				if (!checking && this.idle()) {
					new SetPhotoModal(this.app, file.basename, (image) => {
						void this.run('Saving photo…', () => this.people.setPhoto(file, image));
					}).open();
				}
				return true;
			},
		});
		this.addCommand({
			id: 'update-all',
			name: 'Update all people',
			callback: () => void this.run('Updating people…', (progress) => this.people.updateAll(false, progress)),
		});
		this.addCommand({
			id: 'update-all-refresh-locations',
			name: 'Update all people and refresh locations',
			callback: () => void this.run('Updating people…', (progress) => this.people.updateAll(true, progress)),
		});

		// Clicking a collaborator, institution or country that has no note yet creates one; fill it in.
		// Registered once the vault has loaded: Obsidian reports every existing file as created at startup.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md' && file.stat.size === 0) void this.fillCreated(file);
			}));
		});

		// Profile cards: drawn live from the note's properties wherever a `scholar-atlas` code block is.
		this.registerMarkdownCodeBlockProcessor('scholar-atlas', (_source, el, ctx) => {
			ctx.addChild(new ProfileCard(this.app, el, ctx.sourcePath, () => this.settings.photoWidth));
		});
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<ScholarAtlasSettings> | null;
		this.settings = { ...defaultSettings(), ...saved };
		this.settings.orcidChecked = { ...saved?.orcidChecked };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private apiKey(): string {
		const name = this.settings.apiKeySecret;
		return (name && this.app.secretStorage.getSecret(name)) || '';
	}

	/** Fill a note created by clicking a link in a collaborators block, if it is one. */
	private async fillCreated(file: TFile): Promise<void> {
		// Let Obsidian finish creating and opening it first.
		await new Promise((resolve) => window.setTimeout(resolve, 50));
		if (!(await this.people.isPendingCreation(file))) return;
		await this.run(`Looking up ${file.basename}…`, async () => (await this.people.created(file)) ?? '');
	}

	private openAddPerson(): void {
		if (!this.idle()) return;
		new AddPersonModal(this.app, () => this.people.events(), (person) => {
			void this.run(`Adding ${person.name}…`, () => this.people.add(person));
		}).open();
	}

	/** Whether no job is running; says so if one is. */
	private idle(): boolean {
		if (this.busy) new Notice('Scholar Atlas is already updating. Try again when it finishes.');
		return !this.busy;
	}

	/** Run one job at a time behind a progress notice, then report its result or error. */
	private async run(message: string, job: (progress: (message: string) => void) => Promise<string>): Promise<void> {
		if (!this.idle()) return;
		this.busy = true;
		const notice = new Notice(message, 0);
		try {
			const result = await job((m) => notice.setMessage(m));
			notice.hide();
			new Notice(result, 8000);
		} catch (e) {
			console.error('Scholar Atlas:', e);
			notice.hide();
			new Notice(`Scholar Atlas failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
		} finally {
			this.busy = false;
		}
	}
}
