/**
 * A small in-memory stand-in for the parts of the Obsidian API the plugin
 * uses, so note updates can be tested without Obsidian or the network.
 * `test/register.mjs` makes `import ... from 'obsidian'` resolve here.
 */
import YAML from 'yaml';

// Plugin code uses window.setTimeout (Obsidian's popout-window rule).
(globalThis as { window?: unknown }).window ??= globalThis;

export class TAbstractFile {
	readonly vault: FakeVault;
	readonly path: string;
	readonly name: string;

	constructor(vault: FakeVault, path: string) {
		this.vault = vault;
		this.path = path;
		this.name = path.split('/').pop() ?? path;
	}
}

export class TFile extends TAbstractFile {
	basename = this.name.replace(/\.[^.]+$/, '');
	extension = this.name.includes('.') ? (this.name.split('.').pop() ?? '') : '';
	/** Like Obsidian's: mtime changes whenever the file is written. */
	get stat() {
		return { ctime: 0, mtime: this.vault.writes.get(this.path) ?? 0, size: 0 };
	}
}

export class TFolder extends TAbstractFile {
	get children(): TAbstractFile[] {
		return this.vault.childrenOf(this.path);
	}
}

export class Vault {
	static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => unknown): void {
		cb(root);
		for (const child of root.children) {
			if (child instanceof TFolder) Vault.recurseChildren(child, cb);
			else cb(child);
		}
	}
}

// UI classes the plugin's modules import; never instantiated by these tests.
export class Plugin {}
export class PluginSettingTab {}
export class Modal {}
export class Setting {}
export class SecretComponent {}
export class AbstractInputSuggest {}
export class Notice {}
export class MarkdownRenderChild {}
export class MarkdownRenderer {}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export function parseYaml(text: string): unknown {
	return YAML.parse(text);
}

export function stringifyYaml(value: unknown): string {
	return YAML.stringify(value, { nullStr: '' });
}

const FRONTMATTER = /^---\r?\n([\s\S]*?\r?\n)?---(?:\r?\n|$)/;

export function getFrontMatterInfo(text: string): { exists: boolean; frontmatter: string } {
	const m = text.match(FRONTMATTER);
	return m ? { exists: true, frontmatter: m[1] ?? '' } : { exists: false, frontmatter: '' };
}

// --- network -----------------------------------------------------------------

export interface FakeResponse {
	status: number;
	json?: unknown;
	headers?: Record<string, string>;
}
export type Network = (url: string) => FakeResponse | Promise<FakeResponse>;

let network: Network = (url) => {
	throw new Error(`No network in tests: ${url}`);
};
/** Every URL requested since the last {@link setNetwork}. */
export const requests: string[] = [];

export function setNetwork(handler: Network): void {
	network = handler;
	requests.length = 0;
}

export async function requestUrl({ url }: { url: string }) {
	requests.push(url);
	const r = await network(url);
	return { status: r.status, json: r.json ?? null, headers: r.headers ?? {}, arrayBuffer: new ArrayBuffer(0), text: '' };
}

// --- vault and app ------------------------------------------------------------

export class FakeVault {
	readonly files = new Map<string, string | ArrayBuffer>();
	private readonly folders = new Set<string>();
	/** How many times each path was written. */
	readonly writes = new Map<string, number>();
	/** How many times each path was read. */
	readonly reads = new Map<string, number>();

	constructor(initial: Record<string, string>) {
		for (const [path, text] of Object.entries(initial)) this.put(path, text);
	}

	private put(path: string, content: string | ArrayBuffer): void {
		this.files.set(path, content);
		this.writes.set(path, (this.writes.get(path) ?? 0) + 1);
		const parts = path.split('/');
		for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join('/'));
	}

	text(path: string): string {
		const v = this.files.get(path);
		if (typeof v !== 'string') throw new Error(`No note at ${path}`);
		return v;
	}

	childrenOf(folder: string): TAbstractFile[] {
		const parent = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
		return [
			...[...this.folders].filter((f) => parent(f) === folder).map((f) => new TFolder(this, f)),
			...[...this.files.keys()].filter((p) => parent(p) === folder).map((p) => new TFile(this, p)),
		];
	}

	getFileByPath(path: string): TFile | null {
		return this.files.has(path) ? new TFile(this, path) : null;
	}

	getFolderByPath(path: string): TFolder | null {
		return this.folders.has(path) ? new TFolder(this, path) : null;
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		return this.getFileByPath(path) ?? this.getFolderByPath(path);
	}

	async read(file: TFile): Promise<string> {
		this.reads.set(file.path, (this.reads.get(file.path) ?? 0) + 1);
		return this.text(file.path);
	}

	async cachedRead(file: TFile): Promise<string> {
		return this.read(file);
	}

	async create(path: string, text: string): Promise<TFile> {
		const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		// Like Obsidian, refuse to create a note in a folder that doesn't exist.
		if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
		if (dir && !this.folders.has(dir)) throw new Error(`Folder doesn't exist: ${dir}`);
		this.put(path, text);
		return new TFile(this, path);
	}

	async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
		this.put(path, data);
		return new TFile(this, path);
	}

	async createFolder(path: string): Promise<void> {
		this.folders.add(path);
	}

	async process(file: TFile, fn: (text: string) => string): Promise<string> {
		const text = fn(this.text(file.path));
		this.put(file.path, text);
		return text;
	}
}

export function createApp(vault: FakeVault) {
	return {
		vault,
		fileManager: {
			async processFrontMatter(file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> {
				const text = vault.text(file.path);
				const m = text.match(FRONTMATTER);
				const fm = (YAML.parse(m?.[1] ?? '') ?? {}) as Record<string, unknown>;
				fn(fm);
				const body = m ? text.slice(m[0].length) : text;
				await vault.process(file, () => `---\n${YAML.stringify(fm, { nullStr: '' })}---\n${body}`);
			},
			async getAvailablePathForAttachment(name: string): Promise<string> {
				await vault.createFolder('attachments');
				let path = `attachments/${name}`;
				for (let n = 1; vault.files.has(path); n++) path = `attachments/${name.replace(/(\.\w+)$/, ` ${n}$1`)}`;
				return path;
			},
		},
		metadataCache: {
			// Obsidian keeps every note's parsed properties in memory.
			getFileCache: (file: TFile) => {
				const m = vault.text(file.path).match(FRONTMATTER);
				return m ? { frontmatter: YAML.parse(m[1] ?? '') as unknown } : {};
			},
			// Shortest form, without .md, like Obsidian's default.
			fileToLinktext: (file: TFile) => (file.path.split('/').pop() ?? file.path).replace(/\.md$/, ''),
		},
		workspace: {
			getLeaf: () => ({ openFile: async () => {} }),
		},
		secretStorage: { getSecret: () => null },
	};
}
