import { ImageType } from './media-images.dto';

/** Keys minted by the server: images/<yyyy>/<mm>/<22+ random url-safe chars>.<ext>. Anything else is not ours to serve or complete. */
export const IMAGE_UPLOAD_KEY = /^images\/\d{4}\/\d{2}\/[A-Za-z0-9_-]{22,64}\.(jpg|png|webp)$/;

export const EXT_OF: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const TYPE_OF_EXT: Record<string, ImageType> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** True when the first bytes really are the declared format (JPEG FFD8FF, PNG 89504E470D0A1A0A, WEBP RIFF....WEBP). */
export function matchesMagic(type: ImageType, b: Buffer): boolean {
  switch (type) {
    case 'image/jpeg': return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png': return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp': return b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
  }
}
