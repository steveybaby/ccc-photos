#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
// Allow config to be specified via command line argument
const configFile = process.argv[2] || '../config.json';
const config = require(configFile);

class PhotoProcessor {
  constructor() {
    this.config = config;
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${this.config.cloudflare.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.config.cloudflare.accessKeyId,
        secretAccessKey: this.config.cloudflare.secretAccessKey,
      },
    });
    this.manifest = {
      photos: [],
      groups: [],
      lastUpdated: new Date().toISOString(),
      version: 1
    };
  }

  async loadExistingManifest() {
    try {
      const manifestContent = await fs.readFile(this.config.photos.manifestPath, 'utf8');
      this.manifest = JSON.parse(manifestContent);
      console.log(`Loaded existing manifest with ${this.manifest.photos.length} photos`);
    } catch (error) {
      console.log('No existing manifest found, creating new one');
      this.manifest = {
        photos: [],
        groups: [],
        lastUpdated: new Date().toISOString(),
        version: 1
      };
    }
  }

  async extractGPSData(imagePath) {
    try {
      const metadata = await sharp(imagePath).metadata();

      if (metadata.exif) {
        // Parse EXIF data to extract GPS coordinates
        const exifBuffer = metadata.exif;

        // Use a more reliable EXIF parser
        const exifr = await import('exifr');
        const gpsData = await exifr.default.parse(imagePath, true);

        if (gpsData && gpsData.latitude && gpsData.longitude) {
          return {
            latitude: gpsData.latitude,
            longitude: gpsData.longitude,
            timestamp: gpsData.DateTimeOriginal || gpsData.CreateDate || null
          };
        }
      }

      console.warn(`No GPS data found in ${path.basename(imagePath)}`);
      return null;
    } catch (error) {
      console.warn(`Error extracting GPS from ${path.basename(imagePath)}:`, error.message);
      return null;
    }
  }

  async optimizeImage(inputPath, outputPath) {
    try {
      const image = sharp(inputPath);
      const metadata = await image.metadata();

      let pipeline = image;

      // Auto-rotate based on EXIF orientation to fix rotation issues
      pipeline = pipeline.rotate();

      // Resize if image is too large
      if (metadata.width > this.config.photos.maxWidth) {
        pipeline = pipeline.resize(this.config.photos.maxWidth, null, {
          withoutEnlargement: true
        });
      }

      // Optimize based on format
      if (metadata.format === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: this.config.photos.quality });
      } else if (metadata.format === 'png') {
        pipeline = pipeline.png({ quality: this.config.photos.quality });
      } else if (metadata.format === 'webp') {
        pipeline = pipeline.webp({ quality: this.config.photos.quality });
      }

      await pipeline.toFile(outputPath);

      const inputStats = await fs.stat(inputPath);
      const outputStats = await fs.stat(outputPath);
      const compressionRatio = ((inputStats.size - outputStats.size) / inputStats.size * 100).toFixed(1);

      console.log(`Optimized ${path.basename(inputPath)} - ${compressionRatio}% size reduction`);
      return outputStats.size;
    } catch (error) {
      console.error(`Error optimizing ${path.basename(inputPath)}:`, error.message);
      throw error;
    }
  }

  async uploadToCloudflare(filePath, fileName, contentType) {
    try {
      const fileBuffer = await fs.readFile(filePath);

      const command = new PutObjectCommand({
        Bucket: this.config.cloudflare.bucketName,
        Key: `photos/${fileName}`,
        Body: fileBuffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000', // Cache for 1 year
      });

      await this.s3Client.send(command);

      const cloudflareUrl = `${this.config.cloudflare.bucketUrl}/photos/${fileName}`;
      console.log(`Uploaded ${fileName} to Cloudflare R2`);
      return cloudflareUrl;
    } catch (error) {
      console.error(`Error uploading ${fileName} to Cloudflare:`, error.message);
      throw error;
    }
  }

  generateFileHash(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  async processPhoto(photoPath) {
    const fileName = path.basename(photoPath);
    const fileExtension = path.extname(fileName).toLowerCase();

    // Check if this photo already exists in manifest by filename
    const existingPhoto = this.manifest.photos.find(p => p.originalName === fileName);
    const PROCESSING_VERSION = 2; // Bump this to force re-processing

    if (existingPhoto && existingPhoto.processingVersion >= PROCESSING_VERSION) {
      console.log(`Skipping ${fileName} - already processed (v${existingPhoto.processingVersion})`);
      return existingPhoto;
    } else if (existingPhoto) {
      console.log(`Re-processing ${fileName} - outdated version (v${existingPhoto.processingVersion || 1} -> v${PROCESSING_VERSION})`);
    }

    // Check for duplicates by file hash (only if we're not re-processing for version update)
    const fileBuffer = await fs.readFile(photoPath);
    const fileHash = this.generateFileHash(fileBuffer);
    const duplicatePhoto = this.manifest.photos.find(p => p.fileHash === fileHash && (!existingPhoto || existingPhoto.processingVersion >= PROCESSING_VERSION));
    if (duplicatePhoto && (!existingPhoto || existingPhoto.processingVersion >= PROCESSING_VERSION)) {
      console.log(`Skipping ${fileName} - duplicate of ${duplicatePhoto.originalName} (same hash: ${fileHash.substring(0, 8)}...)`);
      return duplicatePhoto;
    }

    console.log(`Processing ${fileName}...`);

    const photoData = {
      originalName: fileName,
      id: crypto.randomUUID(),
      processed: false,
      error: null,
      fileHash: fileHash,
      processingVersion: PROCESSING_VERSION
    };

    try {
      // Handle videos differently
      if (['.mov', '.mp4', '.avi'].includes(fileExtension)) {
        console.log(`Processing video: ${fileName}`);

        // For videos, just upload without GPS extraction or optimization
        const cloudflareUrl = await this.uploadToCloudflare(
          photoPath,
          fileName,
          'video/mp4'
        );

        photoData.url = cloudflareUrl;
        photoData.type = 'video';
        photoData.lat = null;
        photoData.lng = null;
        photoData.timestamp = null;
        photoData.processed = true;

      } else {
        // Process images
        console.log(`Processing image: ${fileName}`);

        // Extract GPS data
        const gpsData = await this.extractGPSData(photoPath);

        // Create optimized version
        const tempOptimizedPath = path.join('/tmp', `optimized_${fileName}`);
        const optimizedSize = await this.optimizeImage(photoPath, tempOptimizedPath);

        // Upload optimized version to Cloudflare
        const cloudflareUrl = await this.uploadToCloudflare(
          tempOptimizedPath,
          fileName,
          'image/jpeg'
        );

        // Clean up temp file
        await fs.unlink(tempOptimizedPath);

        photoData.url = cloudflareUrl;
        photoData.type = 'image';
        photoData.lat = gpsData?.latitude || null;
        photoData.lng = gpsData?.longitude || null;
        photoData.timestamp = gpsData?.timestamp || null;
        photoData.optimizedSize = optimizedSize;
        photoData.processed = true;
      }

      console.log(`✅ Successfully processed ${fileName}`);
      return photoData;

    } catch (error) {
      console.error(`❌ Error processing ${fileName}:`, error.message);
      photoData.error = error.message;
      return photoData;
    }
  }

  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async getLocationName(lat, lng) {
    try {
      // Use proper User-Agent and email as required by Nominatim usage policy
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`, {
        headers: {
          'User-Agent': 'CCC-Photos-Builder/1.0 (cycling photo mapping tool)',
          'Accept': 'application/json'
        }
      });

      // Check if response is ok and content type is JSON
      if (!response.ok) {
        console.warn(`Geocoding API returned ${response.status}: ${response.statusText}`);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn(`Geocoding API returned non-JSON content: ${contentType}`);
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }

      const data = await response.json();

      if (data && data.display_name) {
        const parts = data.display_name.split(',').map(p => p.trim());
        if (parts.length >= 2) {
          const road = data.address?.road || '';
          const neighborhood = data.address?.neighbourhood || data.address?.suburb || '';
          const city = data.address?.city || data.address?.town || '';
          const state = data.address?.state || '';

          if (neighborhood && city) {
            return `${neighborhood}, ${city}`;
          } else if (road && city) {
            return `${road}, ${city}`;
          } else if (city && state) {
            return `${city}, ${state}`;
          } else if (city) {
            return city;
          } else {
            return parts.slice(0, 2).join(', ');
          }
        }
        return data.display_name;
      }

      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (error) {
      console.warn(`Geocoding failed for ${lat.toFixed(4)}, ${lng.toFixed(4)}:`, error.message);
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  }

  async groupPhotos(photos) {
    console.log('Grouping photos by location...');

    const photosByLocation = photos.filter(p => p.lat && p.lng && p.processed && !p.error);
    const groups = [];
    const used = new Set();
    const radiusMiles = 0.5;

    for (let i = 0; i < photosByLocation.length; i++) {
      if (used.has(i)) continue;

      const group = [photosByLocation[i]];
      used.add(i);

      for (let j = i + 1; j < photosByLocation.length; j++) {
        if (used.has(j)) continue;

        const distance = this.calculateDistance(
          photosByLocation[i].lat,
          photosByLocation[i].lng,
          photosByLocation[j].lat,
          photosByLocation[j].lng
        );

        if (distance <= radiusMiles) {
          group.push(photosByLocation[j]);
          used.add(j);
        }
      }

      // Sort photos within group by timestamp
      group.sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return new Date(a.timestamp) - new Date(b.timestamp);
      });

      const centerLat = group.reduce((sum, photo) => sum + photo.lat, 0) / group.length;
      const centerLng = group.reduce((sum, photo) => sum + photo.lng, 0) / group.length;

      // Get location name using reverse geocoding with rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limit API calls (2 seconds)
      console.log(`Geocoding location ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}...`);
      const locationName = await this.getLocationName(centerLat, centerLng);

      groups.push({
        id: crypto.randomUUID(),
        lat: centerLat,
        lng: centerLng,
        photos: group,
        count: group.length,
        locationName: locationName
      });

      console.log(`Created group: ${locationName} (${group.length} photos)`);
    }

    return groups;
  }

  async scanForPhotos() {
    console.log(`Scanning for photos in ${this.config.photos.sourceDir}...`);

    const photoExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.mov', '.mp4', '.avi'];
    const allFiles = [];

    async function scanDirectory(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (photoExtensions.includes(ext)) {
            allFiles.push(fullPath);
          }
        }
      }
    }

    await scanDirectory(this.config.photos.sourceDir);
    console.log(`Found ${allFiles.length} media files`);
    return allFiles;
  }

  async saveManifest() {
    // Ensure output directory exists
    await fs.mkdir(path.dirname(this.config.photos.manifestPath), { recursive: true });

    this.manifest.lastUpdated = new Date().toISOString();
    this.manifest.version = this.manifest.version + 1;

    await fs.writeFile(
      this.config.photos.manifestPath,
      JSON.stringify(this.manifest, null, 2)
    );

    console.log(`✅ Saved manifest to ${this.config.photos.manifestPath}`);
    console.log(`📊 Total photos: ${this.manifest.photos.length}`);
    console.log(`📍 Photo groups: ${this.manifest.groups.length}`);
  }

  async run() {
    console.log('🚀 Starting photo processing...');

    try {
      // Load existing manifest
      await this.loadExistingManifest();

      // Scan for photos
      const photoFiles = await this.scanForPhotos();

      // Process each photo
      const processedPhotos = [];
      for (const photoFile of photoFiles) {
        const photoData = await this.processPhoto(photoFile);
        processedPhotos.push(photoData);
      }

      // Clean up photos that no longer exist
      const currentFileNames = photoFiles.map(filePath => path.basename(filePath));
      const originalPhotoCount = this.manifest.photos.length;
      this.manifest.photos = this.manifest.photos.filter(photo => {
        if (currentFileNames.includes(photo.originalName)) {
          return true;
        } else {
          console.log(`🗑️  Removing orphaned photo: ${photo.originalName}`);
          return false;
        }
      });

      const removedCount = originalPhotoCount - this.manifest.photos.length;
      if (removedCount > 0) {
        console.log(`🗑️  Removed ${removedCount} orphaned photos from manifest`);
      }

      // Update manifest with new/updated photos
      for (const processedPhoto of processedPhotos) {
        const existingIndex = this.manifest.photos.findIndex(p => p.originalName === processedPhoto.originalName);
        if (existingIndex >= 0) {
          this.manifest.photos[existingIndex] = processedPhoto;
        } else {
          this.manifest.photos.push(processedPhoto);
        }
      }

      // Group photos by location
      this.manifest.groups = await this.groupPhotos(this.manifest.photos);

      // Save manifest
      await this.saveManifest();

      console.log('✅ Photo processing complete!');

    } catch (error) {
      console.error('❌ Error during photo processing:', error);
      process.exit(1);
    }
  }
}

// Run the processor
const processor = new PhotoProcessor();
processor.run().catch(console.error);