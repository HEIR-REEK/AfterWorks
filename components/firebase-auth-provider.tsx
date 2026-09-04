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

function firebaseErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object' || !('code' in err)) return ''
  return typeof err.code === 'string' ? err.code : ''
}

// Maps Firebase error codes to useful, worker-facing messages. Configuration errors are deliberately
// explicit: the old generic "Something went wrong" made a disabled provider and an unauthorized
// deployment domain impossible to distinguish from a worker closing the popup.
function friendlyError(code: string): string {
  if (code.startsWith('auth/requests-from-referer-')) {
    return 'Firebase is rejecting requests from this website. An administrator must add the live hostname to the web API key’s allowed website restrictions.'
  }

  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in.'
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 6 characters.'
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact AfterWorks support.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    case 'auth/web-storage-unsupported':
      return 'This browser is blocking the storage needed to keep you signed in. Allow site storage/cookies or try a normal browser window.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow popups for this site, or open AfterWorks in Chrome, Safari, Firefox, or Edge and try again.'
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled before it finished. Keep the Google window open until you return to AfterWorks.'
    case 'auth/cancelled-popup-request':
      return 'Another Google sign-in window is already open. Finish or close it, then try again.'
    case 'auth/unauthorized-domain': {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'this site'
      return `Google sign-in is not enabled for ${host}. An administrator must add this hostname to Firebase Authentication → Settings → Authorized domains.`
    }
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      return 'This sign-in method is not enabled in Firebase. An administrator must enable Google and Email/Password under Authentication → Sign-in method.'
    case 'auth/account-exists-with-different-credential':
      return 'An account already uses this email with another sign-in method. Sign in with email and password first.'
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'Authentication is misconfigured on this deployment. The Firebase web API key is invalid.'
    case 'auth/app-deleted':
    case 'auth/invalid-app-credential':
    case 'auth/internal-error':
      return 'Firebase could not complete sign-in. Please retry; if it continues, contact AfterWorks support with the error code below.'
    default:
      return 'Sign-in could not be completed. Please retry or contact AfterWorks support with the error code below.'
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
      if (!authRef.current) {
        return { ok: false, error: 'Authentication is not configured on this deployment.', code: 'auth/configuration-not-found' }
      }
      try {
        const cred = await signInWithEmailAndPassword(authRef.current, email, password)
        // Keep the session so they can resend from /verify-email; the app gate blocks profile/KYC.
        if (!cred.user.emailVerified) {
          return { ok: true, needsEmailVerification: true }
        }
        return { ok: true }
      } catch (err) {
        const code = firebaseErrorCode(err)
        return { ok: false, error: friendlyError(code), code }
      }
    }

    async function signUp(
      email: string,
      password: string,
      name: string,
    ): Promise<AuthResult> {
      if (!authRef.current) {
        return { ok: false, error: 'Authentication is not configured on this deployment.', code: 'auth/configuration-not-found' }
      }
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
        const code = firebaseErrorCode(err)
        return { ok: false, error: friendlyError(code), code }
      }
    }

    async function signOut() {
      if (authRef.current) await fbSignOut(authRef.current)
    }

    async function signInWithGoogle(): Promise<AuthResult> {
      if (!authRef.current) {
        return { ok: false, error: 'Authentication is not configured on this deployment.', code: 'auth/configuration-not-found' }
      }
      try {
        const provider = new GoogleAuthProvider()
        provider.setCustomParameters({ prompt: 'select_account' })
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
        const code = firebaseErrorCode(err)
        // Keep the Firebase code out of logs that may contain credentials, but return the stable
        // code to the form so support can distinguish a provider/config issue from cancellation.
        return { ok: false, error: friendlyError(code), code }
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
