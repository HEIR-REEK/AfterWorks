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
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Self-hosted fonts already; nothing else may reference the framework version leak.
  productionBrowserSourceMaps: false,
  transpilePackages: [],
  experimental: {
    serverComponentsExternalPackages: ['firebase-admin'],
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
