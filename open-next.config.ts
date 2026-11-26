import { defineCloudflareConfig } from '@opennextjs/cloudflare'

/**
 * OpenNext configuration for Cloudflare Workers.
 *
 * Deliberately minimal. This app is almost entirely dynamic — every authenticated route is
 * per-user and served `no-store` (see the `headers()` block in next.config.js) — so an
 * incremental/ISR cache would add a KV or R2 binding and a cache-tag invalidation path without
 * serving a real hit. Add `incrementalCache` here only if a genuinely cacheable route appears.
 *
 * The rest of the migration lives outside this file: firebase-admin's gRPC transport and
 * `node:fs` cannot run in workerd, which is why `lib/firestore-rest.ts` exists and why the
 * email logo is bundled rather than read from disk.
 */
export default defineCloudflareConfig({})
