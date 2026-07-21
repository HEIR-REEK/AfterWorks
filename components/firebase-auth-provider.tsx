'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as fbSignOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { createUserDocument } from '@/lib/firestore'

export type FirebaseConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

type AuthResult = { ok: true } | { ok: false; error: string }

type AuthContextValue = {
  user: User | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string, name: string) => Promise<AuthResult>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isConfigComplete(config: FirebaseConfig) {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)
}

// Maps Firebase error codes to friendly, worker-facing messages.
function friendlyError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in.'
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 6 characters.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

export function FirebaseAuthProvider({
  config,
  children,
}: {
  config: FirebaseConfig
  children: ReactNode
}) {
  const configured = isConfigComplete(config)
  const authRef = useRef<Auth | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(configured)

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }
    const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config)
    const auth = getAuth(app)
    authRef.current = auth
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return () => unsub()
  }, [configured, config])

  const value = useMemo<AuthContextValue>(() => {
    async function signIn(email: string, password: string): Promise<AuthResult> {
      if (!authRef.current) return { ok: false, error: 'Auth is not configured.' }
      try {
        await signInWithEmailAndPassword(authRef.current, email, password)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: friendlyError((err as { code?: string })?.code ?? '') }
      }
    }

    async function signUp(
      email: string,
      password: string,
      name: string,
    ): Promise<AuthResult> {
      if (!authRef.current) return { ok: false, error: 'Auth is not configured.' }
      try {
        const cred = await createUserWithEmailAndPassword(authRef.current, email, password)
        if (name) await updateProfile(cred.user, { displayName: name })
        // Persist the user's profile + empty wallet to Firestore
        await createUserDocument(cred.user.uid, name || email.split('@')[0], email)
        setUser({ ...cred.user })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: friendlyError((err as { code?: string })?.code ?? '') }
      }
    }

    async function signOut() {
      if (authRef.current) await fbSignOut(authRef.current)
    }

    return { user, loading, configured, signIn, signUp, signOut }
  }, [user, loading, configured])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within a FirebaseAuthProvider')
  return ctx
}
