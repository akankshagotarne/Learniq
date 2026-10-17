/**
 * Shrinks a chosen photo in the browser before upload: a centred square, at most `max` px, re-encoded as JPEG.
 * The API still re-checks the real file type and size; this keeps uploads small and fast on a phone connection.
 */
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PICKED_BYTES = 8 * 1024 * 1024; // what we are willing to read from disk; the result is far smaller

export const validatePickedPhoto = (file: File): string | null => {
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) return 'Please choose a JPEG, PNG or WebP image.';
  if (file.size > MAX_PICKED_BYTES) return 'This image is too large. Please choose one under 8 MB.';
  return null;
};

export const resizeToSquareJpeg = (file: File, max = 400, quality = 0.85): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const out = Math.min(max, side);
        const canvas = document.createElement('canvas');
        canvas.width = out; canvas.height = out;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas');
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality);
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This file could not be read as an image.')); };
    img.src = url;
  });
