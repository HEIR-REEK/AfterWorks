/**
 * POST /api/kyc/submit
 *
 * Creates a Didit KYC session for the authenticated user and returns
 * the verification URL. The client opens this URL (in a new tab or redirect)
 * and the user completes ID scan, facial match, and liveness on Didit's hosted page.
 *
 * Auth: requires Firebase ID token in Authorization header.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import * as admin from 'firebase-admin'
import { createKycSession } from '@/lib/didit'

// Reuse the Admin SDK singleton (same pattern as wallet route)
function getAdminApp(): admin.app.App {
  if (admin.apps.length > 0) return admin.apps[0] as admin.app.App
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (serviceAccountJson) {
    const sa = JSON.parse(serviceAccountJson) as admin.ServiceAccount
    return admin.initializeApp({ credential: admin.credential.cert(sa) })
  }
  const path = require('path')
  const fs = require('fs')
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  if (filePath) {
    const sa = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath.replace(/^\.\//, '')), 'utf8'))
    return admin.initializeApp({ credential: admin.credential.cert(sa) })
  }
  return admin.initializeApp({ credential: admin.credential.applicationDefault() })
}

export async function POST(req: NextRequest) {
  try {
    // Verify Firebase ID token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization required.' }, { status: 401 })
    }
    const idToken = authHeader.split('Bearer ')[1].trim()

    let uid: string
    try {
      const app = getAdminApp()
      const decoded = await admin.auth(app).verifyIdToken(idToken)
      uid = decoded.uid
    } catch {
      return NextResponse.json({ error: 'Invalid or expired token.' }, { status: 401 })
    }

    // Create the Didit session
    const session = await createKycSession(uid)

    return NextResponse.json({
      sessionToken: session.session_token,
      verificationUrl: session.verification_url,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[KYC submit]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
