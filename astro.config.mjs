// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: process.env.CI ? 'https://steveybaby.github.io' : undefined,
  base: process.env.CI ? '/ccc-photos' : undefined,
  output: 'static',
  trailingSlash: 'ignore'
});
