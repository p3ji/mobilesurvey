/**
 * Client-side photo pipeline (docs/sensor-module-plan.md D6): downscale to the domain's
 * longest-edge cap and re-encode through a canvas. The re-encode is the privacy mechanism,
 * not an optimization — a canvas never carries metadata, so the emitted JPEG has ALL EXIF
 * stripped, including the GPS tag phone cameras embed. Location data can therefore only
 * enter the dataset through the geolocation domain with its own consent.
 *
 * `createImageBitmap` applies the EXIF orientation while decoding (`imageOrientation:
 * 'from-image'` is the default), so stripping the tag doesn't sideways-flip the image.
 */
export async function reencodePhoto(file: Blob, maxEdgePx: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdgePx / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(bmp, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))),
        'image/jpeg',
        0.85,
      );
    });
  } finally {
    bmp.close();
  }
}
