import ExifReader from 'exifr';

export async function extractPhotoData(photoFiles) {
  const photos = [];

  for (const file of photoFiles) {
    try {
      const exif = await ExifReader.parse(file);

      if (exif && exif.latitude && exif.longitude) {
        photos.push({
          file,
          lat: exif.latitude,
          lng: exif.longitude,
          timestamp: exif.DateTimeOriginal || exif.CreateDate || null,
          name: file.name
        });
      }
    } catch (error) {
      console.warn(`Could not extract EXIF from ${file.name}:`, error);
    }
  }

  return photos;
}

export function groupPhotosByLocation(photos, radiusMiles = 0.5) {
  const groups = [];
  const used = new Set();

  const milesPerDegree = 69; // Approximate miles per degree of latitude/longitude

  for (let i = 0; i < photos.length; i++) {
    if (used.has(i)) continue;

    const group = [photos[i]];
    used.add(i);

    for (let j = i + 1; j < photos.length; j++) {
      if (used.has(j)) continue;

      const distance = Math.sqrt(
        Math.pow((photos[i].lat - photos[j].lat) * milesPerDegree, 2) +
        Math.pow((photos[i].lng - photos[j].lng) * milesPerDegree, 2)
      );

      if (distance <= radiusMiles) {
        group.push(photos[j]);
        used.add(j);
      }
    }

    const centerLat = group.reduce((sum, photo) => sum + photo.lat, 0) / group.length;
    const centerLng = group.reduce((sum, photo) => sum + photo.lng, 0) / group.length;

    groups.push({
      lat: centerLat,
      lng: centerLng,
      photos: group,
      count: group.length
    });
  }

  return groups;
}