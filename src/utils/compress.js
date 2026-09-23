import imageCompression from 'browser-image-compression';

export async function compressAvatarImage(file) {
  try {
    return await imageCompression(file, {
      maxSizeMB: 0.2,
      maxWidthOrHeight: 400,
      useWebWorker: true,
      fileType: 'image/webp',
    });
  } catch {
    return file;
  }
}

export async function compressVenueImage(file) {
  try {
    return await imageCompression(file, {
      maxSizeMB: 0.6,
      maxWidthOrHeight: 1600,
      useWebWorker: true,
      fileType: 'image/webp',
    });
  } catch {
    return file;
  }
}

// Portada de campeonato: 1600px lado mayor, WebP, calidad ~0.82. Mantiene aspect ratio, NO agranda
// (maxWidthOrHeight solo reduce), respeta orientación EXIF y conserva transparencia (WebP con alpha).
// A DIFERENCIA de venue/avatar: NO cae al original si falla → LANZA para que el caller muestre error
// claro y NO suba una foto pesada sin optimizar. Peso típico ~200–600 KB.
export async function compressChampionshipCover(file) {
  return await imageCompression(file, {
    maxSizeMB: 0.6,
    maxWidthOrHeight: 1600,
    initialQuality: 0.82,
    useWebWorker: true,
    fileType: 'image/webp',
  });
}
