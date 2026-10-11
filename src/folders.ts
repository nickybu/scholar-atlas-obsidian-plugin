import { type App, normalizePath } from 'obsidian';

/** Create a folder and any missing parents. */
export async function ensureFolder(app: App, dir: string): Promise<void> {
	const parts = normalizePath(dir).split('/').filter(Boolean);
	for (let i = 1; i <= parts.length; i++) {
		const sub = parts.slice(0, i).join('/');
		if (!app.vault.getFolderByPath(sub)) {
			try {
				await app.vault.createFolder(sub);
			} catch {
				// Created meanwhile by another update.
			}
		}
	}
}

/** `folder/name.ext`, or `folder/name 1.ext`, `name 2.ext`… if that's taken. Creates the folder. */
export async function availablePath(app: App, folder: string, name: string, ext: string): Promise<string> {
	const dir = normalizePath(folder);
	await ensureFolder(app, dir);
	let path = normalizePath(`${dir}/${name}.${ext}`);
	for (let n = 1; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${dir}/${name} ${n}.${ext}`);
	return path;
}
