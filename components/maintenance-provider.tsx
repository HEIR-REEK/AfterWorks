'use client'

/**
 * One maintenance-mode subscription per tab.
 *
 * Every component that cares about the outage (the gate, the shell banner, the jobs page, the admin
 * console) used to open its own Firestore listener. That is N listeners for one boolean, each with
 * its own cold-start latency, and each able to disagree with the others while they reconnect.
 * This provider polls the server's projection once and shares the result.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { INERT_MAINTENANCE_VIEW, subscribeToMaintenanceConfig, type MaintenanceView } from '@/lib/firestore'
import { apiFetch } from '@/lib/client-api'
import { useAuth } from '@/components/firebase-auth-provider'

type MaintenanceContextValue = {
  view: MaintenanceView
  /** True when this visitor is exempt (staff session or on-call bypass). */
  bypassed: boolean
  refreshing: boolean
  refresh: () => void
}

const MaintenanceContext = createContext<MaintenanceContextValue | null>(null)

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [view, setView] = useState<MaintenanceView>(INERT_MAINTENANCE_VIEW)
  const [bypassed, setBypassed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => subscribeToMaintenanceConfig(setView), [])

  // Ask (once per identity) whether *this* member is exempt from the blackout.
  useEffect(() => {
    let cancelled = false
    const email = user?.email?.toLowerCase()
    if (!view.enabled || !email) {
      setBypassed(false)
      return
    }
    apiFetch<{ allowed: boolean }>('/api/maintenance/bypass', { method: 'POST' })
      .then((res) => {
        if (!cancelled) setBypassed(Boolean(res.allowed))
      })
      .catch(() => {
        if (!cancelled) setBypassed(false)
      })
    return () => {
      cancelled = true
    }
  }, [view.enabled, view.version, user?.email])

  const refresh = useCallback(() => {
    setRefreshing(true)
    void import('@/lib/firestore').then(({ fetchMaintenanceStatus }) =>
      fetchMaintenanceStatus().then((next) => {
        setView(next)
        setRefreshing(false)
      }),
    )
  }, [])

  const value = useMemo<MaintenanceContextValue>(
    () => ({ view, bypassed, refreshing, refresh }),
    [view, bypassed, refreshing, refresh],
  )

  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>
}

export function useMaintenance(): MaintenanceContextValue {
  const ctx = useContext(MaintenanceContext)
  if (!ctx) {
    // Outside the provider (e.g. the standalone maintenance page) fall back to inert defaults
    // rather than throwing: a status screen must never be the thing that errors.
    return { view: INERT_MAINTENANCE_VIEW, bypassed: true, refreshing: false, refresh: () => {} }
  }
  return ctx
}
