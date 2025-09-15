// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://steveybaby.github.io',
  base: '/ccc-photos',
  output: 'static',
  trailingSlash: 'ignore'
});
