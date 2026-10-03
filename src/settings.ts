import { PluginSettingTab, SecretComponent, type SettingDefinitionItem, type TFile } from 'obsidian';
import type ScholarAtlasPlugin from './main.ts';

export interface ScholarAtlasSettings {
	peopleFolder: string;
	templateFile: string;
	/** Notes suggested in Add person's "Met at" field. */
	eventsFolder: string;
	/** Where institution, city and country notes go (in subfolders). */
	placesFolder: string;
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
	templateFile: 'Templates/Person.md',
	eventsFolder: 'Events',
	placesFolder: 'Places',
	feedFile: 'Research feed.md',
	papersPerPerson: 10,
	feedDays: 90,
	photoWidth: 200,
	mailto: '',
	apiKeySecret: '',
	orcidRecheckDays: 7,
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
				heading: 'Notes',
				items: [
					{
						name: 'People folder',
						desc: 'Where person notes live. Notes in its subfolders count too.',
						control: { type: 'folder', key: 'peopleFolder', defaultValue: DEFAULT_SETTINGS.peopleFolder },
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
					{
						name: 'Events folder',
						desc: 'Notes here are suggested in the "Met at" field when adding a person.',
						control: { type: 'folder', key: 'eventsFolder', defaultValue: DEFAULT_SETTINGS.eventsFolder },
					},
					{
						name: 'Places folder',
						desc: 'Institution, city and country notes go in its Institutions, Cities and Countries subfolders.',
						control: { type: 'folder', key: 'placesFolder', defaultValue: DEFAULT_SETTINGS.placesFolder },
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

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof ScholarAtlasSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = typeof value === 'string' ? value.trim() : value;
		await this.plugin.saveSettings();
	}
}
