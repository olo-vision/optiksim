/**
 * Bilder für Avatar/Logo lokal verkleinern (Data-URL), damit der Browser-Speicher nicht vollläuft.
 */
export async function resizeImageFile(file: File, maxSize = 160, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Bitte eine Bilddatei wählen (PNG, JPG, SVG, WebP).');
  if (file.size > 8 * 1024 * 1024) throw new Error('Die Bilddatei ist zu groß (max. 8 MB).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'));
      i.src = url;
    });
    const w = img.naturalWidth || maxSize;
    const h = img.naturalHeight || maxSize;
    const s = Math.min(1, maxSize / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(type, 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/svg+xml,image/webp';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
