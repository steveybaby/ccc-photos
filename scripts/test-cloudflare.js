#!/usr/bin/env node

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('../config.json');

console.log('Testing Cloudflare R2 connection...');
console.log('Account ID:', config.cloudflare.accountId);
console.log('Bucket:', config.cloudflare.bucketName);

// Try different endpoint formats
const endpoints = [
  `https://${config.cloudflare.accountId}.r2.cloudflarestorage.com`,
  `https://r2.cloudflarestorage.com/${config.cloudflare.accountId}`,
  'https://r2.cloudflarestorage.com'
];

console.log('Trying different endpoint formats...');

for (const endpoint of endpoints) {
  console.log(`\nTrying endpoint: ${endpoint}`);

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: endpoint,
    credentials: {
      accessKeyId: config.cloudflare.accessKeyId,
      secretAccessKey: config.cloudflare.secretAccessKey,
    },
  });

  try {
    const command = new ListObjectsV2Command({
      Bucket: config.cloudflare.bucketName,
      MaxKeys: 5,
    });

    const response = await s3Client.send(command);
    console.log('✅ Connection successful!');
    console.log(`Found ${response.KeyCount || 0} objects in bucket`);

    if (response.Contents && response.Contents.length > 0) {
      console.log('Sample objects:');
      response.Contents.forEach((obj, i) => {
        console.log(`  ${i + 1}. ${obj.Key} (${obj.Size} bytes)`);
      });
    }
    break; // Exit loop on success
  } catch (error) {
    console.error(`❌ Failed with ${endpoint}:`, error.message);
  }
}