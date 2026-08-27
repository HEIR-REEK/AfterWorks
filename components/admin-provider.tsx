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

type AdminContextValue = {
  isAdmin: boolean
  /** True while the admin status is being resolved server-side. */
  checking: boolean
  refresh: () => Promise<void>
}

const AdminContext = createContext<AdminContextValue | null>(null)

/**
 * Resolves the signed-in user's admin status by asking the server
 * (POST /api/admin/me, which verifies the ID token with the Firebase Admin
 * SDK). The client-side flag is purely cosmetic — every admin capability is
 * enforced again server-side on each API call.
 */
export function AdminProvider({ children }: { children: ReactNode }) {
  const { user, configured, loading: authLoading } = useAuth()

  const [isAdmin, setIsAdmin] = useState(false)
  const [checking, setChecking] = useState(true)

  const refresh = useCallback(async () => {
    if (!configured || !user) {
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
  }, [configured, user])

  useEffect(() => {
    if (authLoading) return
    void refresh()
  }, [authLoading, refresh])

  const value = useMemo<AdminContextValue>(
    () => ({ isAdmin, checking: authLoading ? true : checking, refresh }),
    [isAdmin, checking, authLoading, refresh],
  )

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used within an AdminProvider')
  return ctx
}
