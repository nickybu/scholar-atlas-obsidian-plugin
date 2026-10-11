import { PluginSettingTab, SecretComponent, type Setting, type SettingDefinitionItem, type TFile } from 'obsidian';
import { TagSuggest } from './tag-suggest.ts';
import type ScholarAtlasPlugin from './main.ts';
import { type Match, type NoteSelector, orFolder, selector } from './selector.ts';

export interface ScholarAtlasSettings {
	/** Person notes: those in this folder and/or with these tags (see {@link peopleSelector}). */
	peopleFolder: string;
	/** Comma- or space-separated tags, without `#`. */
	peopleTags: string;
	peopleMatch: Match;
	templateFile: string;
	/** Event notes, suggested in Add person's "Met at" field: in this folder and/or with these tags. */
	eventsFolder: string;
	eventsTags: string;
	eventsMatch: Match;
	/** Where institution, city and country notes go (in subfolders). */
	placesFolder: string;
	/** Where photos are saved; empty to follow Obsidian's attachment settings. */
	photosFolder: string;
	feedFile: string;
	papersPerPerson: number;
	feedDays: number;
	/** Width in pixels of the photo on profile cards. */
	photoWidth: number;
	/** Contact address sent to OpenAlex for its polite pool. */
	mailto: string;
	/**
	 * The *name* of a secret in Obsidian's keychain, never the key itself:
	 * data.json syncs, the keychain stays on each device.
	 */
	apiKeySecret: string;
	/** Days between ORCID look-ups for each person during Update all people; 0 for every time. */
	orcidRecheckDays: number;
	/** When each ORCID record was last fetched (ms since epoch). State, not a setting; syncs so devices share it. */
	orcidChecked: Record<string, number>;
}

/** Defaults for everything but state, which {@link defaultSettings} creates fresh. */
export const DEFAULT_SETTINGS: Omit<ScholarAtlasSettings, 'orcidChecked'> = {
	peopleFolder: 'People',
	peopleTags: '',
	peopleMatch: 'any',
	templateFile: 'Templates/Person.md',
	eventsFolder: 'Events',
	eventsTags: '',
	eventsMatch: 'any',
	placesFolder: 'Places',
	photosFolder: 'Photos',
	feedFile: 'Research feed.md',
	papersPerPerson: 10,
	feedDays: 90,
	photoWidth: 200,
	mailto: '',
	apiKeySecret: '',
	orcidRecheckDays: 7,
};

/** Which notes are people. With neither a folder nor tags set, the `People` folder. */
export function peopleSelector(s: ScholarAtlasSettings): NoteSelector {
	return orFolder(selector(s.peopleFolder, s.peopleTags, s.peopleMatch), 'People');
}

/** Which notes are events. With neither a folder nor tags set, the `Events` folder. */
export function eventsSelector(s: ScholarAtlasSettings): NoteSelector {
	return orFolder(selector(s.eventsFolder, s.eventsTags, s.eventsMatch), 'Events');
}

const MATCH_OPTIONS: Record<Match, string> = {
	any: 'In the folder, or tagged',
	all: 'In the folder, and tagged',
};

export function defaultSettings(): ScholarAtlasSettings {
	return { ...DEFAULT_SETTINGS, orcidChecked: {} };
}

export class ScholarAtlasSettingTab extends PluginSettingTab {
	private readonly plugin: ScholarAtlasPlugin;

	constructor(plugin: ScholarAtlasPlugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'People',
				items: [
					{
						name: 'People folder',
						desc: 'Person notes: notes in this folder and its subfolders. New people are created here; if it\'s empty, where Obsidian puts new notes.',
						control: { type: 'folder', key: 'peopleFolder', placeholder: 'No folder' },
					},
					{
						name: 'People tags',
						desc: 'Person notes: notes with any of these tags (nested tags count too). Separate tags with commas. New people get the first one.',
						render: (setting) => this.tagsField(setting, 'peopleTags', 'person, scientist'),
					},
					{
						name: 'With both a folder and tags',
						desc: 'Whether a person note needs to be in the folder or tagged, or both.',
						control: { type: 'dropdown', key: 'peopleMatch', defaultValue: 'any', options: MATCH_OPTIONS },
					},
					{
						name: 'Matching notes',
						searchable: false,
						render: (setting) => {
							this.countRows.people = setting;
							this.refreshCounts();
						},
					},
					{
						name: 'Person template',
						desc: 'New people start from this note. If it doesn\'t exist, a built-in template is used.',
						control: {
							type: 'file',
							key: 'templateFile',
							defaultValue: DEFAULT_SETTINGS.templateFile,
							filter: (file: TFile) => file.extension === 'md',
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Events',
				items: [
					{
						name: 'Events folder',
						desc: 'Event notes, suggested in the "Met at" field when adding a person: notes in this folder and its subfolders.',
						control: { type: 'folder', key: 'eventsFolder', placeholder: 'No folder' },
					},
					{
						name: 'Event tags',
						desc: 'Event notes: notes with any of these tags. Separate tags with commas.',
						render: (setting) => this.tagsField(setting, 'eventsTags', 'event, conference'),
					},
					{
						name: 'With both a folder and tags',
						desc: 'Whether an event note needs to be in the folder or tagged, or both.',
						control: { type: 'dropdown', key: 'eventsMatch', defaultValue: 'any', options: MATCH_OPTIONS },
					},
					{
						name: 'Matching notes',
						searchable: false,
						render: (setting) => {
							this.countRows.events = setting;
							this.refreshCounts();
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Places, photos and papers',
				items: [
					{
						name: 'Places folder',
						desc: 'Institution, city and country notes go in its Institutions, Cities and Countries subfolders.',
						control: { type: 'folder', key: 'placesFolder', defaultValue: DEFAULT_SETTINGS.placesFolder },
					},
					{
						name: 'Photos folder',
						desc: 'Where people\'s photos are saved. Leave empty to follow Obsidian\'s attachment settings (Files and links).',
						control: { type: 'folder', key: 'photosFolder', defaultValue: DEFAULT_SETTINGS.photosFolder },
					},
					{
						name: 'Research feed note',
						desc: 'Rebuilt after every update with everyone\'s recent papers.',
						control: {
							type: 'text',
							key: 'feedFile',
							defaultValue: DEFAULT_SETTINGS.feedFile,
							validate: (v: string) => (v.trim().endsWith('.md') ? undefined : 'Must be a note path ending in .md.'),
						},
					},
					{
						name: 'Papers per person',
						control: { type: 'number', key: 'papersPerPerson', defaultValue: 10, min: 1, max: 50, step: 1 },
					},
					{
						name: 'Research feed window',
						desc: 'How many days back the research feed goes.',
						control: { type: 'number', key: 'feedDays', defaultValue: 90, min: 1, max: 3650, step: 1 },
					},
					{
						name: 'Photo width',
						desc: 'Width in pixels of the photo on profile cards.',
						control: { type: 'number', key: 'photoWidth', defaultValue: 200, min: 40, max: 1000, step: 10 },
					},
				],
			},
			{
				type: 'group',
				heading: 'OpenAlex and ORCID',
				items: [
					{
						name: 'Check ORCID records every',
						desc: 'Days between ORCID look-ups for each person when updating everyone, since ORCID records rarely change. 0 checks every time. Update this person and refreshing locations always check.',
						control: { type: 'number', key: 'orcidRecheckDays', defaultValue: 7, min: 0, max: 365, step: 1 },
					},
					{
						name: 'Contact email',
						desc: 'Optional. OpenAlex gives faster, more reliable service to requests with a contact address.',
						control: { type: 'text', key: 'mailto', placeholder: 'you@example.com' },
					},
					{
						name: 'API key',
						desc: 'Optional. Kept in Obsidian\'s keychain on this device and not synced, so set it once per device.',
						render: (setting) => {
							setting.addComponent((el) => new SecretComponent(this.app, el)
								.setValue(this.plugin.settings.apiKeySecret)
								.onChange(async (name) => { // the secret's name; its value stays in the keychain
									this.plugin.settings.apiKeySecret = name;
									await this.plugin.saveSettings();
								}));
						},
					},
				],
			},
		];
	}

	/** The "Matching notes" rows, updated as the folder, tags and match settings change. */
	private readonly countRows: { people?: Setting; events?: Setting } = {};

	/** A comma-separated tags field that suggests the vault's tags. */
	private tagsField(setting: Setting, key: 'peopleTags' | 'eventsTags', placeholder: string): void {
		setting.addText((t) => {
			t.setPlaceholder(placeholder).setValue(this.plugin.settings[key]).onChange(async (v) => {
				this.plugin.settings[key] = v;
				await this.plugin.saveSettings();
				this.refreshCounts();
			});
			new TagSuggest(this.app, t.inputEl);
		});
	}

	/** Show how many notes the people and events settings pick out right now, with a few names. */
	private refreshCounts(): void {
		const people = this.plugin.people;
		if (!people) return;
		const describe = (notes: TFile[], one: string, many: string) => {
			if (!notes.length) return `No notes match. Check the folder and tags above.`;
			const names = notes.slice(0, 3).map((f) => f.basename).join(', ');
			return `${notes.length} ${notes.length === 1 ? one : many}: ${names}${notes.length > 3 ? '…' : ''}`;
		};
		this.countRows.people?.setDesc(describe(people.list(), 'person', 'people'));
		this.countRows.events?.setDesc(describe(people.events(), 'event', 'events'));
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof ScholarAtlasSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = typeof value === 'string' ? value.trim() : value;
		await this.plugin.saveSettings();
		this.refreshCounts();
	}
}
