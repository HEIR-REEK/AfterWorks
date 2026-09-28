/** @type {import('next').NextConfig} */

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Security headers are also declared here (in addition to `middleware.ts`) because middleware
 * does not run for every static asset, error page or `/_next/image` response. Route-level
 * `headers()` are merged at the framework layer, so the guarantees below hold universally:
 *  • `X-Frame-Options` + `frame-ancestors`   → the console can never be framed or click-jacked
 *  • `no-store` on admin paths               → no PII in a shared CDN or browser cache
 *  • HSTS preload in production              → no HTTP fallback for credential posts
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  ...(isProduction ? [{ key: 'X-Frame-Options', value: 'DENY' }] : []),
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  // Keep OAuth and checkout popups connected to the page that opened them. `same-origin` breaks
  // Firebase signInWithPopup by severing window.opener before Google can return the result.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self), browsing-topics=()' },
  ...(isProduction
    ? [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
      ]
    : []),
]

const noStore = [
  { key: 'Cache-Control', value: 'private, no-store, no-cache, must-revalidate, max-age=0' },
  { key: 'Pragma', value: 'no-cache' },
  { key: 'Expires', value: '0' },
  { key: 'Vary', value: 'Cookie, Authorization' },
]

/**
 * One hostname should own the site's ranking signals. `afterworks.site` and `www.afterworks.site`
 * both resolve and both serve the app, which splits inbound links and crawl budget across two
 * identical copies — and every duplicate URL is a chance for the wrong one to be the one that ranks.
 * The apex is canonical (it is what `NEXT_PUBLIC_APP_URL`, the sitemap and every `rel=canonical` use),
 * so `www` 308s to it. Set `CANONICAL_WWW_REDIRECT=false` if a deployment is meant to be reached on
 * a `www` host.
 */
const canonicalWwwRedirect = isProduction && (process.env.CANONICAL_WWW_REDIRECT ?? 'true') !== 'false'

/**
 * Where `www` sends you. Derived from the same variable the sitemap and canonical tags use, so the
 * redirect cannot point somewhere the rest of the site does not already claim.
 */
const canonicalOrigin = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://afterworks.site')
  .replace(/\/$/, '')
  .replace(/^(https?:\/\/)?/, 'https://')
/**
 * Two cases where the redirect must not be installed: a deployment whose canonical host *is* a `www`
 * host (it would redirect to itself in a loop), and a loopback origin (a local or preview build has
 * no `www` variant to consolidate).
 */
const canonicalHostIsWww = /^https:\/\/www\./i.test(canonicalOrigin)
const canonicalHostIsLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/i.test(canonicalOrigin)

const nextConfig = {
  // Hosted development previews are framed; production remains non-embeddable.
  allowedDevOrigins: ['localhost', '127.0.0.1', '*.e2b.app'],
  outputFileTracingIncludes: {
    '/api/auth/password-reset': ['./public/brand/email-logo.png'],
    '/api/auth/send-verification': ['./public/brand/email-logo.png'],
  },
  env: {
    // Only the publishable key is exposed. PAYSTACK_SECRET_KEY must never be NEXT_PUBLIC_* —
    // anything prefixed that way is compiled into the JavaScript bundle and is public forever.
    NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
    APP_VERSION: process.env.APP_VERSION || process.env.GIT_SHA || 'dev',
  },
  poweredByHeader: false,
  reactStrictMode: false, // effects here subscribe/unsubscribe live listeners; keep deterministic
  compress: true,
  typescript: { ignoreBuildErrors: false },
  // Self-hosted fonts already; nothing else may reference the framework version leak.
  productionBrowserSourceMaps: false,
  transpilePackages: [],
  // `experimental.serverComponentsExternalPackages` was renamed in Next 15+; the old key is ignored
  // with a warning, which would quietly bundle firebase-admin into the server build.
  serverExternalPackages: ['firebase-admin'],
  experimental: {
    // lucide-react ships hundreds of icons; tree-shake them at import time instead of bundling all.
    // Note: the self-hosted font packages must NOT be listed here. optimizePackageImports rewrites
    // sub-path imports for the listed packages, and Next then tries to parse their `index.css` as
    // JavaScript ("Expression expected" at compile time).
    optimizePackageImports: ['lucide-react'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 420, 640, 768, 1024, 1280, 1536],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    minimumCacheTTL: 86400,
    dangerouslyAllowSVG: false,
    localPatterns: [{ pathname: '/**' }],
  },
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
  async redirects() {
    if (!canonicalWwwRedirect || canonicalHostIsWww || canonicalHostIsLoopback) return []
    return [
      {
        // No named capture group: Next 16 lowercases `has` match keys before the destination is
        // built, so `:canonicalHost` arrives as `canonicalhost` and throws
        // `TypeError: Expected "canonicalhost" to be a string` on every `www` request. The target is
        // a known constant anyway — that is the whole point of picking a canonical host.
        source: '/:path*',
        has: [{ type: 'host', value: 'www\\..+' }],
        destination: `${canonicalOrigin}/:path*`,
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/admin/:path*', headers: noStore },
      { source: '/api/admin/:path*', headers: noStore },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }] },
      {
        source: '/api/health',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=5, s-maxage=10' }],
      },
      {
        source: '/maintenance',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ]
  },
}

module.exports = nextConfig
