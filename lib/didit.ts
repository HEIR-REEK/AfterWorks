/**
 * Didit KYC API helper — server-side only.
 *
 * Didit uses a simple API key (x-api-key header) for auth.
 * Base URL: https://verification.didit.me
 *
 * Docs: https://docs.didit.me
 */

const DIDIT_BASE_URL = 'https://verification.didit.me'
const DIDIT_API_KEY = process.env.DIDIT_API_KEY || ''
const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID || ''

// The URL Didit should redirect the user back to after verification
function callbackUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${appUrl}/kyc/callback`
}

export async function createKycSession(userId: string, isMobile?: boolean, origin?: string) {
  // Detect unconfigured / placeholder env values
  const missingKey = !DIDIT_API_KEY || DIDIT_API_KEY.startsWith('your_')
  const missingWorkflow = !DIDIT_WORKFLOW_ID || DIDIT_WORKFLOW_ID.startsWith('your_')

  if (missingKey) {
    throw new Error(
      'DIDIT_API_KEY is not configured. Go to https://business.didit.me → API & Webhooks to get your key, then set it in .env.',
    )
  }
  if (missingWorkflow) {
    throw new Error(
      'DIDIT_WORKFLOW_ID is not configured. Create a verification workflow in the Didit Business Console and set it in .env.',
    )
  }

  const baseCbUrl = origin ? `${origin}/kyc/callback` : callbackUrl()
  const cbUrl = isMobile
    ? `${baseCbUrl}?device=mobile`
    : `${baseCbUrl}?device=cross_device`

  const response = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
    method: 'POST',
    headers: {
      'x-api-key': DIDIT_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: userId,          // ties session to your Firebase UID
      callback: cbUrl,              // Didit redirects here after flow
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Didit session creation failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  // Didit returns: { session_token, url, session_id, status, ... }
  // Normalize 'url' → 'verification_url' for consistency with the rest of the app
  return {
    ...data,
    verification_url: data.url ?? data.verification_url,
  }
}

/**
 * Retrieve the current status of a Didit KYC session.
 * Uses the session_id returned from createKycSession.
 */
export async function getKycSessionStatus(sessionId: string) {
  if (!DIDIT_API_KEY) throw new Error('DIDIT_API_KEY is not configured.')

  const response = await fetch(`${DIDIT_BASE_URL}/v3/session/${sessionId}`, {
    method: 'GET',
    headers: {
      'x-api-key': DIDIT_API_KEY,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Didit status fetch failed (${response.status}): ${errorText}`)
  }

  return response.json()
}

/**
 * Verify a Didit webhook signature.
 * Didit signs webhooks with HMAC-SHA256 using DIDIT_WEBHOOK_SECRET.
 * Call this inside your webhook route before trusting the payload.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = process.env.DIDIT_WEBHOOK_SECRET
  if (!secret || !signatureHeader) return false

  try {
    const { createHmac } = await import('crypto')
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    return signatureHeader === expected
  } catch {
    return false
  }
}
