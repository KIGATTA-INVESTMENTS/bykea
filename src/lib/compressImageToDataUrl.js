/**
 * Draw `file` onto a resized canvas; returns null if not a drawable image.
 * @param {File} file
 * @param {number} maxEdge longest side in px
 * @returns {Promise<HTMLCanvasElement | null>}
 */
function loadImageOntoCanvas(file, maxEdge) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/') || file.type === 'image/gif') {
      resolve(null);
      return;
    }
    const objUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      let { width, height } = img;
      const longest = Math.max(width, height);
      const scale = longest > maxEdge ? maxEdge / longest : 1;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not process image.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('Could not read this image.'));
    };
    img.src = objUrl;
  });
}

/**
 * Read an image file and return a JPEG data URL (resized, compressed) for inline preview / state.
 * @param {File} file
 * @param {number} maxEdge longest side in px
 * @param {number} quality 0–1 for JPEG
 */
export async function compressImageToDataUrl(file, maxEdge = 1200, quality = 0.82) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }
  const canvas = await loadImageOntoCanvas(file, maxEdge);
  if (!canvas) throw new Error('Please choose an image file.');
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Compress an image for storage upload. Non-images (e.g. PDF) are returned unchanged.
 * @param {File} file
 * @param {number} maxEdge longest side in px
 * @param {number} quality 0–1 for JPEG
 * @returns {Promise<File>}
 */
export async function compressImageForUpload(file, maxEdge = 1600, quality = 0.8) {
  if (!file) return file;
  try {
    const canvas = await loadImageOntoCanvas(file, maxEdge);
    if (!canvas) return file;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not process image.'))),
        'image/jpeg',
        quality,
      );
    });
    // Skip if compression did not shrink (already small / highly compressed).
    if (blob.size >= file.size * 0.95) return file;
    const base = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
