import { env } from 'process';

const DIDIT_API_URL = process.env.DIDIT_API_URL || 'https://apx.didit.me';
const DIDIT_CLIENT_ID = process.env.DIDIT_CLIENT_ID || '';
const DIDIT_CLIENT_SECRET = process.env.DIDIT_CLIENT_SECRET || '';
const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID || '';

/**
 * Authenticate with Didit to get an access token.
 * This assumes standard OAuth2 client credentials flow or similar.
 */
async function getDiditAccessToken() {
  const response = await fetch(`${DIDIT_API_URL}/auth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${DIDIT_CLIENT_ID}:${DIDIT_CLIENT_SECRET}`).toString('base64')}`
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to authenticate with Didit: ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Create a new Didit KYC session.
 */
export async function createKycSession(userId: string) {
  const token = await getDiditAccessToken();
  
  const response = await fetch(`${DIDIT_API_URL}/v3/session/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      workflow_id: DIDIT_WORKFLOW_ID,
      vendor_data: userId, // associate the session with our user ID
      // You can add more config such as redirect_url if needed
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create Didit session: ${errorText}`);
  }

  const data = await response.json();
  // Returns something like { session_token: '...', verification_url: '...' }
  return data;
}

/**
 * Fetch the current status of a Didit KYC session.
 * Used for the API polling fallback strategy.
 */
export async function getKycSessionStatus(sessionToken: string) {
  const token = await getDiditAccessToken();
  
  const response = await fetch(`${DIDIT_API_URL}/v3/session/${sessionToken}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch Didit session status: ${errorText}`);
  }

  const data = await response.json();
  return data;
}
