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
import { useAuth } from '@/components/firebase-auth-provider'
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  loadDemoMaintenance,
  saveDemoMaintenance,
  type MaintenanceConfig,
} from '@/lib/admin-data'

type MaintenanceContextValue = {
  maintenance: MaintenanceConfig
  /** True until the first state has been resolved (never blocking render). */
  loading: boolean
  /** True while running against demo (localStorage) state — Firebase unconfigured. */
  demo: boolean
  refresh: () => Promise<void>
  /** Admin-only: update the maintenance config (Firestore or demo store). */
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

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const { configured } = useAuth()
  const demo = !configured

  const [maintenance, setMaintenance] = useState<MaintenanceConfig>(DEFAULT_STATE)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (demo) {
      setMaintenance(loadDemoMaintenance())
      setLoading(false)
      return
    }
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
  }, [demo])

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

  // Demo mode: react to instant changes made from the admin panel.
  useEffect(() => {
    if (!demo) return
    const handler = () => setMaintenance(loadDemoMaintenance())
    window.addEventListener('aw-maintenance-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('aw-maintenance-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [demo])

  const updateMaintenance = useCallback<MaintenanceContextValue['updateMaintenance']>(
    async (config) => {
      if (demo) {
        const next: MaintenanceConfig = {
          ...loadDemoMaintenance(),
          ...config,
          updatedAt: new Date().toISOString(),
          updatedBy: 'demo-admin',
        }
        saveDemoMaintenance(next)
        setMaintenance(next)
        return { ok: true }
      }

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
    [demo, refresh],
  )

  const value = useMemo<MaintenanceContextValue>(
    () => ({ maintenance, loading, demo, refresh, updateMaintenance }),
    [maintenance, loading, demo, refresh, updateMaintenance],
  )

  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>
}

export function useMaintenance() {
  const ctx = useContext(MaintenanceContext)
  if (!ctx) throw new Error('useMaintenance must be used within a MaintenanceProvider')
  return ctx
}
