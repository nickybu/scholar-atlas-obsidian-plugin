/**
 * Country names from ISO codes, using the platform's built-in list so every
 * note names a country the same way, with no requests.
 */

let names: Intl.DisplayNames | null | undefined;
let codes: Map<string, string> | null = null;

function displayNames(): Intl.DisplayNames | null {
	if (names === undefined) {
		try {
			names = new Intl.DisplayNames(['en'], { type: 'region' });
		} catch {
			names = null;
		}
	}
	return names;
}

/** "CH" -> "Switzerland"; the code itself if it isn't known. */
export function countryName(code: string): string {
	const c = code.trim().toUpperCase();
	try {
		return displayNames()?.of(c) ?? c;
	} catch {
		return c;
	}
}

const simplify = (name: string) => name.trim().toLowerCase().replace(/^the\s+/, '');

/** "Switzerland" or "The Netherlands" -> "CH" / "NL"; null if not a country name. */
export function countryCode(name: string): string | null {
	if (!codes) {
		codes = new Map();
		const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
		for (const a of letters) {
			for (const b of letters) {
				const code = a + b;
				const n = countryName(code);
				if (n !== code) codes.set(simplify(n), code);
			}
		}
	}
	return codes.get(simplify(name)) ?? null;
}
