// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Host is Cloudflare Workers (AD-1). The adapter exists so that one on-demand
// route (/api/contact, wired at gate 11) can run; every content page carries
// `export const prerender = true` and is served as a file.
export default defineConfig({
  site: 'https://www.rexdalemobilewash.ca',
  adapter: cloudflare(),
  trailingSlash: 'always',
  build: { format: 'directory' },
});
