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

type AuthResult =
  | { ok: true; isNewUser?: boolean; needsEmailVerification?: boolean }
  | { ok: false; error: string; code?: string }

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
  /** Force-refresh the Firebase user so `emailVerified` is current after the Resend link is clicked. */
  reloadUser: () => Promise<boolean>
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string, name: string) => Promise<AuthResult>
  signInWithGoogle: () => Promise<AuthResult>
  signOut: () => Promise<void>
  /** Re-sends a Resend verification email to the currently signed-in (but unverified) user. */
  resendVerification: () => Promise<{ ok: boolean; error?: string; alreadyVerified?: boolean }>
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
      // Reload so a verification that happened on another device is visible without a full sign-in.
      void current
        .reload()
        .then(() => {
          setUser(authRef.current?.currentUser ?? null)
          return current.getIdTokenResult(true)
        })
        .then((result) => setClaims({ admin: result.claims?.admin === true }))
        .catch(() => {})
    }
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
    return () => {
      unsub()
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
    }
  }, [configured, config])

  const value = useMemo<AuthContextValue>(() => {
    async function getIdToken(forceRefresh = false): Promise<string | null> {
      try {
        return (await authRef.current?.currentUser?.getIdToken(forceRefresh)) ?? null
      } catch {
        return null
      }
    }

    async function reloadUser(): Promise<boolean> {
      const current = authRef.current?.currentUser
      if (!current) return false
      try {
        await current.reload()
        const next = authRef.current?.currentUser ?? null
        setUser(next)
        if (next) {
          const result = await next.getIdTokenResult(true)
          setClaims({ admin: result.claims?.admin === true })
        }
        return Boolean(authRef.current?.currentUser?.emailVerified)
      } catch {
        return false
      }
    }

    async function requestVerificationEmail(idToken: string): Promise<{ ok: boolean; error?: string; alreadyVerified?: boolean }> {
      try {
        const res = await fetch('/api/auth/send-verification', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { accept: 'application/json', authorization: `Bearer ${idToken}` },
          cache: 'no-store',
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; alreadyVerified?: boolean }
        if (!res.ok) {
          return { ok: false, error: data.error || 'Failed to send verification email. Please try again.' }
        }
        return { ok: true, alreadyVerified: data.alreadyVerified === true }
      } catch {
        return { ok: false, error: 'Network error. Check your connection and try again.' }
      }
    }

    async function signIn(email: string, password: string): Promise<AuthResult> {
      if (!authRef.current) return { ok: false, error: 'Auth is not configured.' }
      try {
        const cred = await signInWithEmailAndPassword(authRef.current, email, password)
        // Keep the session so they can resend from /verify-email; the app gate blocks profile/KYC.
        if (!cred.user.emailVerified) {
          return { ok: true, needsEmailVerification: true }
        }
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
        await createUserDocument(cred.user.uid, name || email.split('@')[0], email)
        setUser(cred.user)
        try {
          const token = await cred.user.getIdToken()
          await requestVerificationEmail(token)
        } catch {
          // Account exists; /verify-email lets them resend. Do not fail the signup.
        }
        return { ok: true, isNewUser: true, needsEmailVerification: !cred.user.emailVerified }
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
        setUser(cred.user)
        const additionalInfo = getAdditionalUserInfo(cred)
        if (!cred.user.emailVerified) {
          try {
            const token = await cred.user.getIdToken()
            await requestVerificationEmail(token)
          } catch {
            /* resend is available on /verify-email */
          }
          return { ok: true, isNewUser: additionalInfo?.isNewUser ?? false, needsEmailVerification: true }
        }
        return { ok: true, isNewUser: additionalInfo?.isNewUser ?? false }
      } catch (err) {
        return { ok: false, error: friendlyError((err as { code?: string })?.code ?? '') }
      }
    }

    async function resendVerification(): Promise<{ ok: boolean; error?: string; alreadyVerified?: boolean }> {
      const currentUser = authRef.current?.currentUser
      if (!currentUser) return { ok: false, error: 'No signed-in user found. Please try signing in again.' }
      try {
        const token = await currentUser.getIdToken()
        return await requestVerificationEmail(token)
      } catch {
        return { ok: false, error: 'Failed to send verification email. Please try again.' }
      }
    }

    return { user, loading, configured, claims, getIdToken, reloadUser, signIn, signUp, signInWithGoogle, signOut, resendVerification }
  }, [user, loading, configured, claims])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within a FirebaseAuthProvider')
  return ctx
}
