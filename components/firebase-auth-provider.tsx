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
  GoogleAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo,
  type Auth,
  type User,
} from 'firebase/auth'
import { createUserDocument } from '@/lib/firestore'

export type FirebaseConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
  storageBucket?: string
  messagingSenderId?: string
}

type AuthResult = { ok: true; isNewUser?: boolean } | { ok: false; error: string }

type AuthContextValue = {
  user: User | null
  loading: boolean
  configured: boolean
  /**
   * Claims from the current ID token. `admin` here is minted server-side by the Admin SDK — the
   * client cannot write it, which is what makes it usable as a UI hint (nav badge) without being a
   * security boundary.
   */
  claims: { admin?: boolean } | null
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string, name: string) => Promise<AuthResult>
  signInWithGoogle: () => Promise<AuthResult>
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
  const [claims, setClaims] = useState<{ admin?: boolean } | null>(null)

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
      if (!u) {
        setClaims(null)
        return
      }
      // Read the token claims once per session, and again whenever the tab regains focus.
      void u.getIdTokenResult().then((result) => setClaims({ admin: result.claims?.admin === true })).catch(() => setClaims(null))
    })
    const onFocus = () => {
      const current = authRef.current?.currentUser
      if (!current) return
      void current.getIdTokenResult(true).then((result) => setClaims({ admin: result.claims?.admin === true })).catch(() => {})
    }
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
    const cleanup = () => {
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
    }
    void cleanup
    return () => unsub()
  }, [configured, config])

  const value = useMemo<AuthContextValue>(() => {
    async function getIdToken(forceRefresh = false): Promise<string | null> {
      try {
        return (await authRef.current?.currentUser?.getIdToken(forceRefresh)) ?? null
      } catch {
        return null
      }
    }

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
        return { ok: true, isNewUser: true }
      } catch (err) {
        return { ok: false, error: friendlyError((err as { code?: string })?.code ?? '') }
      }
    }

    async function signOut() {
      if (authRef.current) await fbSignOut(authRef.current)
    }

    async function signInWithGoogle(): Promise<AuthResult> {
      if (!authRef.current) return { ok: false, error: 'Auth is not configured.' }
      try {
        const provider = new GoogleAuthProvider()
        const cred = await signInWithPopup(authRef.current, provider)
        const name = cred.user.displayName || cred.user.email?.split('@')[0] || 'Worker'
        await createUserDocument(cred.user.uid, name, cred.user.email || '')
        setUser({ ...cred.user })
        const additionalInfo = getAdditionalUserInfo(cred)
        return { ok: true, isNewUser: additionalInfo?.isNewUser ?? false }
      } catch (err) {
        return { ok: false, error: friendlyError((err as { code?: string })?.code ?? '') }
      }
    }

    return { user, loading, configured, claims, getIdToken, signIn, signUp, signInWithGoogle, signOut }
  }, [user, loading, configured, claims])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within a FirebaseAuthProvider')
  return ctx
}
