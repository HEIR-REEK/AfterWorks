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
import { getDemoRole, setDemoRole, clearDemoRole, type DemoRole } from '@/lib/admin-data'

type AdminContextValue = {
  isAdmin: boolean
  /** True while the admin status is being resolved. */
  checking: boolean
  /** Demo mode (Firebase auth not configured) — role stored in localStorage. */
  demo: boolean
  demoRole: DemoRole | null
  /** True once the demo role has been read from localStorage. */
  demoResolved: boolean
  setDemoRole: (role: DemoRole) => void
  refresh: () => Promise<void>
}

const AdminContext = createContext<AdminContextValue | null>(null)

export function AdminProvider({ children }: { children: ReactNode }) {
  const { user, configured, loading: authLoading } = useAuth()
  const demo = !configured

  const [isAdmin, setIsAdmin] = useState(false)
  const [checking, setChecking] = useState(true)
  const [demoRole, setDemoRoleState] = useState<DemoRole | null>(null)
  /**
   * False until the demo role has been read from localStorage on the client.
   * AppGate waits for this before redirecting, so refreshing an admin page in
   * demo mode doesn't bounce the user to sign-in (and avoids hydration
   * mismatches, since server and client first render agree on "unresolved").
   */
  const [demoResolved, setDemoResolved] = useState(false)

  // ── Demo mode: admin status mirrors the localStorage demo role ────────────
  useEffect(() => {
    if (!demo) {
      setDemoRoleState(null)
      setDemoResolved(true)
      return
    }
    const sync = () => setDemoRoleState(getDemoRole())
    sync()
    setDemoResolved(true)
    window.addEventListener('aw-demo-role-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('aw-demo-role-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [demo])

  const refresh = useCallback(async () => {
    if (demo) {
      setIsAdmin(getDemoRole() === 'admin')
      setChecking(false)
      return
    }
    if (!user) {
      setIsAdmin(false)
      setChecking(false)
      return
    }
    setChecking(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/admin/me', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const data = await res.json()
      setIsAdmin(Boolean(data.isAdmin))
    } catch {
      setIsAdmin(false)
    } finally {
      setChecking(false)
    }
  }, [demo, user])

  useEffect(() => {
    if (demo || authLoading) return
    void refresh()
  }, [demo, authLoading, refresh])

  // ── Demo role changes resolve instantly ───────────────────────────────────
  useEffect(() => {
    if (demo) {
      setIsAdmin(demoRole === 'admin')
      setChecking(false)
    }
  }, [demo, demoRole])

  const value = useMemo<AdminContextValue>(
    () => ({
      isAdmin,
      checking: demo ? !demoResolved : checking,
      demo,
      demoRole,
      demoResolved,
      setDemoRole: (role) => {
        setDemoRole(role)
        setDemoRoleState(role)
      },
      refresh,
    }),
    [isAdmin, checking, demo, demoRole, demoResolved, refresh],
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used within an AdminProvider')
  return ctx
}

export { clearDemoRole }
