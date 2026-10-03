import { scaledSize } from './photo.ts';
import type { PhotoImage } from './photo-picker.ts';

// Formats worth re-encoding. GIFs may be animated and SVGs are vectors, so they're kept as they are.
const RESIZABLE = new Set(['jpg', 'png', 'webp', 'bmp', 'avif']);

/**
 * Scale a photo down so its longest side is at most `maxSide` pixels and save
 * it as a JPEG, so phone photos don't add megabytes to the vault. Returns the
 * original when it's already small enough, isn't a resizable format, or the
 * platform can't decode it.
 */
export async function shrinkPhoto(image: PhotoImage, maxSide: number): Promise<PhotoImage> {
	if (!RESIZABLE.has(image.ext) || typeof createImageBitmap !== 'function') return image;
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(new Blob([image.data]));
	} catch {
		return image;
	}
	try {
		const size = scaledSize(bitmap.width, bitmap.height, maxSide);
		if (!size) return image;
		const canvas = createEl('canvas', { attr: { width: size.width, height: size.height } });
		const ctx = canvas.getContext('2d');
		if (!ctx) return image;
		// JPEG has no transparency: put transparent PNGs on white rather than black.
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, size.width, size.height);
		ctx.drawImage(bitmap, 0, 0, size.width, size.height);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
		if (!blob || blob.size >= image.data.byteLength) return image;
		return { data: await blob.arrayBuffer(), ext: 'jpg' };
	} finally {
		bitmap.close();
	}
}
