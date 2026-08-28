import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'
import { getAdminEmails, ADMIN_MASTER_PASSWORD } from '@/lib/admin'
import { createAdminAuditLog, checkUserAdminRoleAdmin } from '@/lib/firestore-admin'

// ─── Rate Limiting & Anti-Brute-Force Cache ──────────────────────────────────
type RateLimitRecord = {
  attempts: number
  firstAttemptAt: number
  lockedUntil?: number
}

const rateLimitMap = new Map<string, RateLimitRecord>()

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes lockout

function getClientIdentifier(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1'
  return ip
}

function checkRateLimit(clientId: string): { allowed: boolean; remaining: number; retryAfterSec?: number } {
  const now = Date.now()
  const record = rateLimitMap.get(clientId)

  if (!record) {
    return { allowed: true, remaining: MAX_ATTEMPTS }
  }

  // Check if locked out
  if (record.lockedUntil && record.lockedUntil > now) {
    const retryAfterSec = Math.ceil((record.lockedUntil - now) / 1000)
    return { allowed: false, remaining: 0, retryAfterSec }
  }

  // Reset if window has expired
  if (now - record.firstAttemptAt > WINDOW_MS) {
    rateLimitMap.delete(clientId)
    return { allowed: true, remaining: MAX_ATTEMPTS }
  }

  const remaining = Math.max(0, MAX_ATTEMPTS - record.attempts)
  if (record.attempts >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((record.firstAttemptAt + WINDOW_MS - now) / 1000)
    return { allowed: false, remaining: 0, retryAfterSec }
  }

  return { allowed: true, remaining }
}

function recordFailedAttempt(clientId: string): { remaining: number; locked: boolean } {
  const now = Date.now()
  const record = rateLimitMap.get(clientId) || { attempts: 0, firstAttemptAt: now }

  record.attempts += 1

  if (record.attempts >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS
    rateLimitMap.set(clientId, record)
    return { remaining: 0, locked: true }
  }

  rateLimitMap.set(clientId, record)
  return { remaining: MAX_ATTEMPTS - record.attempts, locked: false }
}

function clearRateLimit(clientId: string): void {
  rateLimitMap.delete(clientId)
}

function antiCacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
  }
}

// ─── POST /api/admin/auth ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const clientId = getClientIdentifier(req)

  // 1. Validate Rate Limit
  const rateStatus = checkRateLimit(clientId)
  if (!rateStatus.allowed) {
    return NextResponse.json(
      {
        error: `Too many failed administrative login attempts. Access temporarily locked for security. Please try again in ${rateStatus.retryAfterSec || 900} seconds.`,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateStatus.retryAfterSec || 900),
          ...antiCacheHeaders(),
        },
      },
    )
  }

  // 2. Anti-Phishing & Anti-Spoofing: Validate Origin / Referer
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')

  if (origin && host) {
    try {
      const originHost = new URL(origin).host
      if (originHost !== host && !origin.includes('localhost') && !origin.includes('127.0.0.1') && !origin.includes('onrender.com')) {
        return NextResponse.json(
          { error: 'Untrusted origin request rejected.' },
          { status: 403, headers: antiCacheHeaders() },
        )
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid origin header.' },
        { status: 400, headers: antiCacheHeaders() },
      )
    }
  }

  try {
    const body = await req.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password.trim() : ''

    if (!email || !password) {
      recordFailedAttempt(clientId)
      return NextResponse.json(
        { error: 'Invalid administrator credentials or unauthorized access.' },
        { status: 401, headers: antiCacheHeaders() },
      )
    }

    // Basic email format sanity check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email) || email.length > 254) {
      recordFailedAttempt(clientId)
      return NextResponse.json(
        { error: 'Invalid administrator credentials or unauthorized access.' },
        { status: 401, headers: antiCacheHeaders() },
      )
    }

    // 3. Verify Admin Authorization (via Environment Whitelist or Firestore Role)
    const envAdmins = getAdminEmails().map((e) => e.toLowerCase().trim())
    const isEnvAdmin = envAdmins.includes(email)
    const isFirestoreAdmin = await checkUserAdminRoleAdmin(email)

    const isAuthorizedAdmin = isEnvAdmin || isFirestoreAdmin

    // Check configured password securely using timing-safe comparison
    const configuredPassword = ADMIN_MASTER_PASSWORD || process.env.ADMIN_PASSWORD || ''
    
    let isPasswordValid = false
    if (configuredPassword && password.length === configuredPassword.length) {
      isPasswordValid = crypto.timingSafeEqual(Buffer.from(password), Buffer.from(configuredPassword))
    }

    if (!isAuthorizedAdmin || !isPasswordValid) {
      const attemptResult = recordFailedAttempt(clientId)

      // Log suspicious failed attempt for audit compliance
      try {
        await createAdminAuditLog(
          'ADMIN_LOGIN_FAILED',
          {
            emailAttempted: email,
            ip: clientId,
            attemptsRemaining: attemptResult.remaining,
            timestamp: new Date().toISOString(),
          },
          'SecurityGateway',
        )
      } catch {
        // non-blocking
      }

      return NextResponse.json(
        {
          error: 'Invalid administrator credentials or unauthorized access.',
          remainingAttempts: attemptResult.remaining,
        },
        { status: 401, headers: antiCacheHeaders() },
      )
    }

    // 4. Successful Authentication
    clearRateLimit(clientId)

    // Generate cryptographic admin session token
    const tokenSecret = process.env.ADMIN_SESSION_SECRET || 'afterworks-secure-admin-secret-key-2026'
    const timestamp = Date.now()
    const payload = `${email}:${timestamp}`
    const signature = crypto.createHmac('sha256', tokenSecret).update(payload).digest('hex')
    const sessionToken = `${Buffer.from(payload).toString('base64')}.${signature}`

    // Log successful admin access in immutable audit log
    try {
      await createAdminAuditLog(
        'ADMIN_LOGIN_SUCCESS',
        {
          email,
          ip: clientId,
          userAgent: req.headers.get('user-agent') || 'Unknown',
          timestamp: new Date().toISOString(),
        },
        email,
      )
    } catch (logErr) {
      console.warn('[AdminAuthAPI] Audit log notice:', logErr)
    }

    const response = NextResponse.json(
      {
        ok: true,
        email,
        token: sessionToken,
        expiresIn: 24 * 60 * 60, // 24 hours
      },
      {
        headers: antiCacheHeaders(),
      },
    )

    // Set secure, HttpOnly session cookie
    response.cookies.set('afterworks_admin_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/admin',
      maxAge: 24 * 60 * 60, // 24 hours
    })

    return response
  } catch (err) {
    console.error('[AdminAuthAPI] Server error:', err)
    return NextResponse.json(
      { error: 'An internal authentication error occurred.' },
      { status: 500, headers: antiCacheHeaders() },
    )
  }
}
