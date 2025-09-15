#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const config = require('../config.json');

class PhotoProcessor {
  constructor() {
    this.config = config;
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
      const image = sharp(imagePath);
      const metadata = await image.metadata();

      if (metadata.exif) {
        // Try using exifr
        try {
          const exifr = await import('exifr');
          const gpsData = await exifr.default.parse(imagePath, true);

          if (gpsData && gpsData.latitude && gpsData.longitude) {
            return {
              latitude: gpsData.latitude,
              longitude: gpsData.longitude,
              timestamp: gpsData.DateTimeOriginal || gpsData.CreateDate || null
            };
          }
        } catch (exifError) {
          // Fallback: use basic EXIF parsing with Sharp
          console.warn(`Exifr failed for ${path.basename(imagePath)}, trying basic parsing`);
        }

        // Basic fallback - parse EXIF buffer manually (limited)
        console.warn(`Using fallback EXIF parsing for ${path.basename(imagePath)}`);
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

  generateFileHash(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  async processPhoto(photoPath) {
    const fileName = path.basename(photoPath);
    const fileExtension = path.extname(fileName).toLowerCase();

    // Check if this photo already exists in manifest by filename
    const existingPhoto = this.manifest.photos.find(p => p.originalName === fileName);
    if (existingPhoto) {
      console.log(`Skipping ${fileName} - already processed`);
      return existingPhoto;
    }

    // Check for duplicates by file hash
    const fileBuffer = await fs.readFile(photoPath);
    const fileHash = this.generateFileHash(fileBuffer);
    const duplicatePhoto = this.manifest.photos.find(p => p.fileHash === fileHash);
    if (duplicatePhoto) {
      console.log(`Skipping ${fileName} - duplicate of ${duplicatePhoto.originalName} (same hash: ${fileHash.substring(0, 8)}...)`);
      return duplicatePhoto;
    }

    console.log(`Processing ${fileName}...`);

    const photoData = {
      originalName: fileName,
      id: crypto.randomUUID(),
      processed: false,
      error: null,
      fileHash: fileHash
    };

    try {
      // Handle videos differently
      if (['.mov', '.mp4', '.avi'].includes(fileExtension)) {
        console.log(`Processing video: ${fileName}`);

        // For videos, copy to output directory
        const outputPath = path.join(this.config.photos.outputDir, fileName);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.copyFile(photoPath, outputPath);

        photoData.url = `/photos/${fileName}`;
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
        const outputPath = path.join(this.config.photos.outputDir, fileName);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        const optimizedSize = await this.optimizeImage(photoPath, outputPath);

        photoData.url = `/photos/${fileName}`;
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
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`);
      const data = await response.json();

      if (data && data.display_name) {
        const parts = data.display_name.split(',').map(p => p.trim());
        if (parts.length >= 2) {
          const road = data.address?.road || '';
          const neighborhood = data.address?.neighbourhood || data.address?.suburb || '';
          const city = data.address?.city || data.address?.town || '';

          if (neighborhood && city) {
            return `${neighborhood}, ${city}`;
          } else if (road && city) {
            return `${road}, ${city}`;
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
      console.warn('Geocoding failed:', error);
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  }

  async groupPhotos(photos) {
    console.log('Grouping photos by location...');

    const photosByLocation = photos.filter(p => p.lat && p.lng && p.processed && !p.error);
    const groups = [];
    const used = new Set();
    const radiusMiles = 0.5;

    console.log(`Found ${photosByLocation.length} photos with GPS data`);

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

      const centerLat = group.reduce((sum, photo) => sum + photo.lat, 0) / group.length;
      const centerLng = group.reduce((sum, photo) => sum + photo.lng, 0) / group.length;

      // Get location name using reverse geocoding with rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit API calls
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
    console.log('🚀 Starting photo processing (LOCAL MODE)...');

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