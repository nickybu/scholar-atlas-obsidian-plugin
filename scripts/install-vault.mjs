// Copy the built plugin into a vault for testing:
//   npm run build && npm run install-vault -- "/path/to/vault"
// Then reload Obsidian (or toggle the plugin off and on).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

const vault = process.argv[2] ?? process.env.OBSIDIAN_VAULT;
if (!vault || !existsSync(join(vault, '.obsidian'))) {
	console.error('Usage: npm run install-vault -- "/path/to/vault" (a folder containing .obsidian/)');
	process.exit(1);
}
if (!existsSync('main.js')) {
	console.error('main.js not found: run `npm run build` first.');
	process.exit(1);
}
const { id } = JSON.parse(readFileSync('manifest.json', 'utf8'));
const dest = join(vault, '.obsidian', 'plugins', id);
mkdirSync(dest, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
	if (existsSync(file)) copyFileSync(file, join(dest, file));
}
console.log(`Installed ${id} into ${dest}`);
