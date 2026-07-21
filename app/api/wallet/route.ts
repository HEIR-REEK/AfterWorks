/**
 * GET /api/wallet
 *
 * Reads the authenticated user's wallet balance from Firestore via Firebase Admin SDK.
 * The client sends a Firebase ID token in the Authorization header.
 * We verify the token, look up the user document in Firestore, and return wallet data.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import * as admin from 'firebase-admin'
import * as fs from 'fs'
import * as path from 'path'

// Initialise the Firebase Admin SDK once (singleton pattern for Next.js)
function getAdminApp(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0] as admin.app.App
  }

  const projectId = process.env.FIREBASE_PROJECT_ID
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH

  if (serviceAccountPath) {
    try {
      // Use fs.readFileSync so Next.js doesn't warn about dynamic require()
      const resolvedPath = path.resolve(
        process.cwd(),
        serviceAccountPath.replace(/^\.\//, ''),
      )
      const raw = fs.readFileSync(resolvedPath, 'utf8')
      const serviceAccount = JSON.parse(raw) as admin.ServiceAccount

      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: (serviceAccount as unknown as { project_id: string }).project_id || projectId,
      })
    } catch (err) {
      console.warn('Could not load service account file:', err)
    }
  }

  // Fall back to application default credentials
  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  })
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization header with Bearer token required' },
        { status: 401 },
      )
    }

    const idToken = authHeader.split('Bearer ')[1].trim()

    // Verify the Firebase ID token
    let uid: string
    try {
      const app = getAdminApp()
      const decodedToken = await admin.auth(app).verifyIdToken(idToken)
      uid = decodedToken.uid
    } catch (err) {
      console.error('Token verification failed:', err)
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    // Fetch the user's document from Firestore
    const app = getAdminApp()
    const db = admin.firestore(app)
    const snap = await db.collection('users').doc(uid).get()

    if (!snap.exists) {
      // User document doesn't exist yet — return zero balances
      return NextResponse.json({
        pendingUsd: 0,
        availableUsd: 0,
        payoutNumber: '',
      })
    }

    const data = snap.data() as Record<string, unknown>
    const wallet = (data?.wallet as Record<string, unknown>) ?? {}

    return NextResponse.json({
      pendingUsd: (wallet.pendingUsd as number) ?? 0,
      availableUsd: (wallet.availableUsd as number) ?? 0,
      payoutNumber: (wallet.payoutNumber as string) ?? '',
    })
  } catch (error) {
    console.error('Wallet API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch wallet data' },
      { status: 500 },
    )
  }
}
