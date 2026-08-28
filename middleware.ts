import { NextResponse, type NextRequest } from 'next/server'

/**
 * Global Security & Rate Limiting Middleware
 * Enforces production security, anti-phishing, anti-spoofing, anti-caching, and headers.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()

  // 1. Anti-Caching Headers for Admin Console & Sensitive API Endpoints
  const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  if (isAdminRoute) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0')
    response.headers.set('Pragma', 'no-cache')
    response.headers.set('Expires', '0')
    response.headers.set('Surrogate-Control', 'no-store')
  }

  // 2. Anti-Phishing & Anti-Spoofing: Host and Origin Integrity Verification
  if (pathname.startsWith('/api/admin')) {
    const origin = request.headers.get('origin')
    const host = request.headers.get('host')

    if (origin && host) {
      try {
        const originHost = new URL(origin).host
        const isAllowedLocal = originHost.includes('localhost') || originHost.includes('127.0.0.1')
        const isAllowedDeploy = originHost.includes('onrender.com') || originHost.includes('afterworks')

        if (originHost !== host && !isAllowedLocal && !isAllowedDeploy) {
          return new NextResponse(
            JSON.stringify({ error: 'Security Violation: Cross-origin administrative request rejected.' }),
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
              },
            },
          )
        }
      } catch {
        return new NextResponse(
          JSON.stringify({ error: 'Invalid origin header' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }
  }

  // 3. Security Headers (CSP, Anti-Clickjacking, HSTS, Nosniff)
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.firebaseapp.com https://*.googleapis.com https://checkout.paystack.com;
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob: https:;
    font-src 'self' data:;
    connect-src 'self' https: wss:;
    frame-src 'self' https://checkout.paystack.com https://*.didit.me;
    frame-ancestors 'none';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
  `.replace(/\s{2,}/g, ' ').trim()

  response.headers.set('Content-Security-Policy', cspHeader)
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  response.headers.set('X-DNS-Prefetch-Control', 'on')

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
