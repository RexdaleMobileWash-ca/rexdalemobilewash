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
  // Nothing on this site stores a session: every page is a prerendered file and
  // /api/contact/ reads a request and sends an email. Left at its default the
  // adapter declares a `SESSION` KV binding with no namespace id, and
  // `wrangler deploy` then tries to provision one — which fails outright here
  // ("Authentication error [code: 10000]" on /storage/kv/namespaces), and if it
  // succeeded would create a KV namespace the client pays for and nothing reads.
  // The deployed Worker's bindings are `[]`; this keeps them that way.
  session: false,
});
