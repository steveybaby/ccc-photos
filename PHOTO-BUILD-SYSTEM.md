# Photo Build System

This project includes an automated photo processing system that handles GPS extraction, image optimization, Cloudflare R2 uploads, and location grouping.

## Setup

### 1. Configure Cloudflare R2

1. Copy the example config:
   ```bash
   cp config.example.json config.json
   ```

2. Fill in your Cloudflare R2 credentials in `config.json`:
   ```json
   {
     "cloudflare": {
       "accountId": "your-cloudflare-account-id",
       "accessKeyId": "your-r2-access-key-id",
       "secretAccessKey": "your-r2-secret-access-key",
       "bucketName": "your-r2-bucket-name",
       "bucketUrl": "https://your-bucket.your-domain.com"
     }
   }
   ```

### 2. Organize Your Photos

Place your photos in the `./photos` directory. The script supports:

**Supported Formats:**
- **Images**: `.jpg`, `.jpeg`, `.png`, `.webp`
- **Videos**: `.mov`, `.mp4`, `.avi`

**Directory Structure:**
```
photos/
├── day 1/
│   ├── IMG_001.jpeg
│   ├── IMG_002.jpeg
│   └── video.MOV
├── day 2/
│   └── more photos...
└── additional photos...
```

## Usage

### Process Photos

Run the build script to process all photos:

```bash
npm run build:photos
```

This will:
1. ✅ **Scan** all photos in the `./photos` directory
2. ✅ **Extract GPS data** from image EXIF (images only)
3. ✅ **Optimize images** (resize large images, compress)
4. ✅ **Upload to Cloudflare R2** (both images and videos)
5. ✅ **Group photos by location** (within 0.5 miles)
6. ✅ **Generate reverse geocoded location names**
7. ✅ **Create manifest** at `./public/photos-manifest.json`

### Build for Production

The regular build process now includes photo processing:

```bash
npm run build
```

This runs `build:photos` first, then builds the Astro site.

## How It Works

### Photo Processing

**Images:**
- GPS coordinates extracted from EXIF data
- Images resized if larger than 1920px width
- Quality compressed to 85%
- Uploaded to Cloudflare R2
- Original filename preserved

**Videos:**
- Uploaded directly without processing
- No GPS extraction (videos rarely have GPS data)
- Will appear in manifest but won't create map markers

### Location Grouping

- Photos within 0.5 miles are grouped together
- Each group gets a center coordinate
- Location names fetched using reverse geocoding (OpenStreetMap)
- Groups become camera markers on the map

### Manifest Structure

The generated `photos-manifest.json` contains:

```json
{
  "photos": [
    {
      "originalName": "IMG_001.jpeg",
      "id": "uuid",
      "url": "https://your-bucket.com/photos/IMG_001.jpeg",
      "type": "image",
      "lat": 37.7749,
      "lng": -122.4194,
      "timestamp": "2025-09-06T15:30:00Z",
      "processed": true
    }
  ],
  "groups": [
    {
      "id": "uuid",
      "lat": 37.7749,
      "lng": -122.4194,
      "photos": [...],
      "count": 5,
      "locationName": "Golden Gate Park, San Francisco"
    }
  ],
  "lastUpdated": "2025-09-14T20:00:00Z",
  "version": 1
}
```

### Website Integration

The PhotoLoader component automatically:
1. Loads the manifest from `/photos-manifest.json`
2. Uses pre-processed GPS data and groups
3. Falls back to hardcoded list if manifest not found
4. Creates map markers from manifest groups

## Benefits

✅ **Faster Loading**: No client-side EXIF processing
✅ **Better Performance**: Optimized images, CDN delivery
✅ **Scalable**: Handles unlimited photos
✅ **GitHub Pages Compatible**: Small repo size
✅ **Automatic Grouping**: Smart location-based clustering
✅ **Incremental**: Only processes new/changed photos

## Troubleshooting

**Build fails with "Photos manifest not found":**
- Run `npm run build:photos` first
- Check that `config.json` has correct Cloudflare credentials

**Photos don't appear on map:**
- Ensure photos have GPS data in EXIF
- Check browser console for manifest loading errors
- Verify Cloudflare R2 bucket is publicly accessible

**Videos not working:**
- Videos are uploaded but don't get GPS coordinates
- They won't create map markers unless manually assigned coordinates
- Check video URLs are accessible from Cloudflare

## Adding New Photos

1. Add new photos to the `./photos` directory
2. Run `npm run build:photos`
3. The script will only process new photos (incremental)
4. Deploy the updated manifest and site

The system maintains a manifest of processed photos and only processes new ones on subsequent runs.