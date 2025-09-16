// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: process.env.CI ? 'https://ccc.sharpers.com' : undefined,
  output: 'static',
  trailingSlash: 'ignore',
  server: {
    // Uncomment for local HTTPS development
    // https: true
  }
});
