import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'scripts',
		'test',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', {
				brands: ['Scholar Atlas', 'OpenAlex', 'ORCID'],
				acronyms: ['ORCID', 'ID', 'MB'],
			}],
		},
	},
	// The recommended config doesn't lint manifest.json itself; check it against
	// the community directory's rules (description format, forbidden words…).
	{
		files: ['manifest.json'],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: { parser: tseslint.parser, parserOptions: { projectService: false } },
		plugins: { obsidianmd },
		rules: { 'obsidianmd/validate-manifest': 'error' },
	},
);
