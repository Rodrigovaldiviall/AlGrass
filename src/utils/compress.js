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
