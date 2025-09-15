# Photo Update Guide for Days 5-8

This guide explains how to easily update the website when photos are added for days 5-8.

## Overview

Days 5-8 are now fully set up with:
- ✅ Complete webpage structures (`day5.astro`, `day6.astro`, `day7.astro`, `day8.astro`)
- ✅ GPX route files copied to `/public/gpx/`
- ✅ Navigation updated with correct route names and all days enabled
- ✅ Placeholder photo manifests ready for updates

## Routes Configured

- **Day 5**: Cambria to Pismo Beach (Tue, Sep 10, 2025)
- **Day 6**: Pismo Beach to Buellton (Wed, Sep 11, 2025)
- **Day 7**: Buellton to Ventura (Thu, Sep 12, 2025)
- **Day 8**: Ventura to Malibu (Fri, Sep 13, 2025)

## How to Add Photos

### Option 1: Using Build Scripts (Recommended)

1. **Copy photos to the appropriate day folder**:
   ```bash
   # Example for Day 5
   mkdir -p "/path/to/photo/folder/day 5"
   # Copy your photos there
   ```

2. **Run the build script**:
   ```bash
   cd /Users/steve/Websites/ccc-photos
   node scripts/build-photos.js config-day5.json
   ```

3. **Repeat for other days** using:
   - `config-day6.json`
   - `config-day7.json`
   - `config-day8.json`

### Option 2: Manual Update

If you need to update manifests manually:

1. **Edit the manifest file**:
   - `/public/photos-manifest-day5.json`
   - `/public/photos-manifest-day6.json`
   - `/public/photos-manifest-day7.json`
   - `/public/photos-manifest-day8.json`

2. **Update the structure**:
   ```json
   {
     "photos": [
       {
         "originalName": "IMG_001.jpg",
         "url": "/optimized/day5/IMG_001.webp",
         "lat": 35.1234,
         "lng": -120.5678,
         "timestamp": "2025-09-10T10:30:00Z",
         "type": "image",
         "processed": true,
         "error": null
       }
     ],
     "groups": [...],
     "lastUpdated": "2025-09-10T12:00:00Z",
     "totalPhotos": 1,
     "day": 5,
     "route": "Cambria to Pismo Beach"
   }
   ```

## Website Features

Each day page includes:
- **Interactive map** with GPX route visualization
- **Ride statistics** (distance, elevation, max speed with sparkline)
- **Photo/video count tile** that opens first photo when clicked
- **Photo markers** on map grouped by location
- **Photo carousel** with navigation between all photos
- **Responsive design** for mobile and desktop

## File Locations

- **Pages**: `/src/pages/day[5-8].astro`
- **GPX Files**: `/public/gpx/CCC_Day_[5-8]_*.gpx`
- **Manifests**: `/public/photos-manifest-day[5-8].json`
- **Navigation**: `/src/components/DayNavigation.astro`

## Notes

- All pages use the same blue color scheme as days 1-4
- Navigation tooltips show route details on hover
- Photo/video tiles show actual counts (e.g., "41 Photos", "3 Videos")
- Pages are ready to use immediately - just add photos and run the build script!