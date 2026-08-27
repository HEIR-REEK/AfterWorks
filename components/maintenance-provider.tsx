'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  type MaintenanceConfig,
} from '@/lib/admin-data'

type MaintenanceContextValue = {
  maintenance: MaintenanceConfig
  /** True until the first state has been fetched from the server. */
  loading: boolean
  refresh: () => Promise<void>
  /** Admin-only: update the maintenance config (server verifies admin status). */
  updateMaintenance: (
    config: Partial<MaintenanceConfig> & { enabled: boolean },
  ) => Promise<{ ok: boolean; error?: string }>
}

const DEFAULT_STATE: MaintenanceConfig = {
  enabled: false,
  message: DEFAULT_MAINTENANCE_MESSAGE,
}

const MaintenanceContext = createContext<MaintenanceContextValue | null>(null)

const POLL_INTERVAL_MS = 30_000

/**
 * Keeps the platform-wide maintenance state fresh: initial fetch + polling of
 * the public GET /api/maintenance endpoint (backed by Firestore
 * site_config/settings via the Admin SDK). Updates go through the admin-only
 * POST /api/admin/maintenance route.
 */
export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const [maintenance, setMaintenance] = useState<MaintenanceConfig>(DEFAULT_STATE)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/maintenance', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as MaintenanceConfig
        setMaintenance({
          enabled: Boolean(data.enabled),
          message: data.message || DEFAULT_MAINTENANCE_MESSAGE,
          estimatedUntil: data.estimatedUntil,
          updatedAt: data.updatedAt,
          updatedBy: data.updatedBy,
        })
      }
    } catch {
      // Network hiccup — keep last known state.
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + polling while the tab is visible.
  useEffect(() => {
    void refresh()
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void refresh()
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  const updateMaintenance = useCallback<MaintenanceContextValue['updateMaintenance']>(
    async (config) => {
      try {
        const res = await fetch('/api/admin/maintenance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(config),
        })
        const data = await res.json()
        if (!res.ok) return { ok: false, error: data.error ?? 'Failed to update maintenance mode.' }
        await refresh()
        return { ok: true }
      } catch {
        return { ok: false, error: 'Network error while updating maintenance mode.' }
      }
    },
    [refresh],
  )

  const value = useMemo<MaintenanceContextValue>(
    () => ({ maintenance, loading, refresh, updateMaintenance }),
    [maintenance, loading, refresh, updateMaintenance],
  )

  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>
}

export function useMaintenance() {
  const ctx = useContext(MaintenanceContext)
  if (!ctx) throw new Error('useMaintenance must be used within a MaintenanceProvider')
  return ctx
}
