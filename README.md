# CCC Photos

Interactive cycling photo gallery built with Astro, featuring:

- GPX route visualization with Leaflet maps
- GPS-tagged photo mapping and grouping
- Multi-day navigation system
- Photo carousel with location-based organization
- Automatic geocoding for location names
- Cloudflare R2 storage integration

## Live Site

Visit: https://steveybaby.github.io/ccc-photos

## Development

```bash
npm install
npm run dev
```

## Photo Processing

```bash
# Process Day 1 photos
node scripts/build-photos.js

# Process Day 2 photos  
node scripts/build-photos.js config-day2.json

# Process Day 3 photos
node scripts/build-photos.js config-day3.json
```
