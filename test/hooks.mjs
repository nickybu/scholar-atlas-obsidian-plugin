export async function resolve(specifier, context, next) {
	if (specifier === 'obsidian') {
		return { url: new URL('./fake-obsidian.ts', import.meta.url).href, shortCircuit: true };
	}
	return next(specifier, context);
}
