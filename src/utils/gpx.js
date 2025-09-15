function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateSpeed(distance, time1, time2) {
  if (!time1 || !time2) return 0;
  const timeDiff = (new Date(time2) - new Date(time1)) / 1000 / 3600; // hours
  return timeDiff > 0 ? distance / timeDiff : 0;
}

export function parseGPX(gpxText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, 'application/xml');

  const trackPoints = Array.from(doc.querySelectorAll('trkpt')).map(point => ({
    lat: parseFloat(point.getAttribute('lat')),
    lng: parseFloat(point.getAttribute('lon')),
    elevation: point.querySelector('ele')?.textContent ? parseFloat(point.querySelector('ele').textContent) : null,
    time: point.querySelector('time')?.textContent || null
  }));

  const bounds = trackPoints.reduce((acc, point) => ({
    minLat: Math.min(acc.minLat, point.lat),
    maxLat: Math.max(acc.maxLat, point.lat),
    minLng: Math.min(acc.minLng, point.lng),
    maxLng: Math.max(acc.maxLng, point.lng)
  }), {
    minLat: trackPoints[0]?.lat || 0,
    maxLat: trackPoints[0]?.lat || 0,
    minLng: trackPoints[0]?.lng || 0,
    maxLng: trackPoints[0]?.lng || 0
  });

  // Calculate statistics
  let totalDistance = 0;
  let totalElevationGain = 0;
  let maxSpeed = 0;
  let maxSpeedPoint = null;
  let minElevation = Infinity;
  let maxElevation = -Infinity;

  for (let i = 1; i < trackPoints.length; i++) {
    const prev = trackPoints[i - 1];
    const curr = trackPoints[i];

    // Calculate distance
    const segmentDistance = calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);
    totalDistance += segmentDistance;

    // Calculate elevation gain
    if (prev.elevation !== null && curr.elevation !== null) {
      const elevationDiff = curr.elevation - prev.elevation;
      if (elevationDiff > 0) {
        totalElevationGain += elevationDiff;
      }

      minElevation = Math.min(minElevation, curr.elevation);
      maxElevation = Math.max(maxElevation, curr.elevation);
    }

    // Calculate speed
    const speed = calculateSpeed(segmentDistance, prev.time, curr.time);
    if (speed > maxSpeed && speed < 100) { // Filter out unrealistic speeds
      maxSpeed = speed;
      maxSpeedPoint = curr;
    }
  }

  // Convert meters to feet for elevation
  if (minElevation !== Infinity) {
    totalElevationGain = totalElevationGain * 3.28084; // meters to feet
    minElevation = minElevation * 3.28084;
    maxElevation = maxElevation * 3.28084;
  } else {
    minElevation = 0;
    maxElevation = 0;
  }

  return {
    trackPoints,
    bounds,
    name: doc.querySelector('name')?.textContent || 'Route',
    statistics: {
      totalDistance: totalDistance,
      totalElevationGain: totalElevationGain,
      maxSpeed: maxSpeed,
      maxSpeedPoint: maxSpeedPoint,
      minElevation: minElevation,
      maxElevation: maxElevation
    }
  };
}