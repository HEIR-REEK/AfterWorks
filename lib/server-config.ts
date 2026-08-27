/**
 * Server-side platform settings (maintenance mode) helpers.
 *
 * The single source of truth is the Firestore document
 * `site_config/settings` — field `maintenance: MaintenanceConfig`.
 * When Firebase Admin credentials are missing the state
 * falls back to the MAINTENANCE_MODE / NEXT_PUBLIC_MAINTENANCE_MODE env vars,
 * so maintenance can still be enforced in deployments without Firestore.
 */

import * as admin from 'firebase-admin'
import { getAdminFirestore, firebaseAdminConfigured } from '@/lib/firestore-admin'
import {
  COLLECTIONS,
  SITE_CONFIG_DOC,
  DEFAULT_MAINTENANCE_MESSAGE,
  type MaintenanceConfig,
} from '@/lib/admin-data'

function envMaintenanceEnabled(): boolean {
  const raw =
    process.env.MAINTENANCE_MODE ?? process.env.NEXT_PUBLIC_MAINTENANCE_MODE ?? ''
  return /^(1|true|on|yes)$/i.test(raw.trim())
}

/**
 * Reads the current maintenance state. Never throws — falls back to env
 * defaults so a Firestore outage cannot take the whole site down.
 */
export async function getMaintenanceState(): Promise<MaintenanceConfig & { configured: boolean }> {
  const fallback: MaintenanceConfig & { configured: boolean } = {
    enabled: envMaintenanceEnabled(),
    message: DEFAULT_MAINTENANCE_MESSAGE,
    configured: false,
  }

  if (!firebaseAdminConfigured()) return fallback

  try {
    const db = getAdminFirestore()
    if (!db) return fallback
    const snap = await db.collection(COLLECTIONS.siteConfig).doc(SITE_CONFIG_DOC).get()
    if (!snap.exists) return fallback

    const data = snap.data() as { maintenance?: Partial<MaintenanceConfig> } | undefined
    const m = data?.maintenance
    if (!m) return fallback

    return {
      enabled: Boolean(m.enabled) || envMaintenanceEnabled(),
      message: m.message || DEFAULT_MAINTENANCE_MESSAGE,
      estimatedUntil: m.estimatedUntil,
      updatedAt: m.updatedAt,
      updatedBy: m.updatedBy,
      configured: true,
    }
  } catch (err) {
    console.warn('[ServerConfig] getMaintenanceState failed, using fallback:', err)
    return fallback
  }
}

/**
 * Writes the maintenance config to Firestore.
 * Returns true on success.
 */
export async function setMaintenanceState(
  config: MaintenanceConfig,
): Promise<boolean> {
  try {
    const db = getAdminFirestore()
    if (!db) return false
    await db
      .collection(COLLECTIONS.siteConfig)
      .doc(SITE_CONFIG_DOC)
      .set({ maintenance: config }, { merge: true })
    return true
  } catch (err) {
    console.error('[ServerConfig] setMaintenanceState failed:', err)
    return false
  }
}

/**
 * Guard for worker-facing mutating API routes: returns a 503 response while
 * maintenance mode is enabled. Webhooks and /api/admin/* routes are exempt.
 */
export async function maintenanceGateResponse(): Promise<Response | null> {
  const state = await getMaintenanceState()
  if (!state.enabled) return null
  return new Response(
    JSON.stringify({
      error: 'AfterWorks is temporarily down for maintenance. Please try again soon.',
      maintenance: true,
    }),
    {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '3600' },
    },
  )
}
