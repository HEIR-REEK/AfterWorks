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
  signInWithRedirect,
  getRedirectResult,
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
  isDemo: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string, name: string) => Promise<AuthResult>
  signInWithGoogle: () => Promise<AuthResult>
  signInAsDemoUser: (asWorker?: boolean) => Promise<AuthResult>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isConfigComplete(config: FirebaseConfig) {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)
}

/**
 * Creates a mock Firebase User object that fulfills User interface requirements
 * and prevents null/undefined property crashes in components.
 */
function createMockUser(email: string, displayName: string, providerId = 'password'): User {
  const uid = `demo_usr_${Math.random().toString(36).substring(2, 9)}`
  return {
    uid,
    email,
    displayName,
    emailVerified: true,
    isAnonymous: false,
    metadata: {
      creationTime: new Date().toISOString(),
      lastSignInTime: new Date().toISOString(),
    },
    providerData: [
      {
        uid,
        displayName,
        email,
        phoneNumber: null,
        photoURL: null,
        providerId,
      },
    ],
    refreshToken: 'demo-refresh-token',
    tenantId: null,
    phoneNumber: null,
    photoURL: null,
    providerId,
    delete: async () => {},
    getIdToken: async () => 'demo-id-token',
    getIdTokenResult: async () => ({
      token: 'demo-id-token',
      claims: { email, user_id: uid },
      authTime: new Date().toISOString(),
      issuedAtTime: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 3600000).toISOString(),
      signInProvider: providerId,
      signInSecondFactor: null,
    }),
    reload: async () => {},
    toJSON: () => ({ uid, email, displayName }),
  } as unknown as User
}

// Maps Firebase error codes to friendly, worker-facing messages.
export function friendlyError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  const message = (err as { message?: string })?.message ?? ''

  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.'
    case 'auth/weak-password':
      return 'Password is too weak. Please use at least 6 characters.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Incorrect email or password.'
    case 'auth/user-not-found':
      return 'No account found with this email. Please check or create an account.'
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection and try again.'
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled before completing.'
    case 'auth/popup-blocked':
      return 'The sign-in popup was blocked by your browser. Please allow popups for this site, or try again.'
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Console. Go to Firebase Console → Authentication → Settings → Authorized domains and add this domain.'
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled in Firebase. Please enable Google in Firebase Console → Authentication → Sign-in method.'
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method. Try signing in with your email and password.'
    case 'auth/cancelled-popup-request':
      return 'Another sign-in window was already open. Please try again.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.'
    case 'auth/requires-recent-login':
      return 'Please sign out and sign in again to perform this sensitive action.'
    default:
      if (message && !message.startsWith('Firebase:')) {
        return message
      }
      return 'Authentication failed. Please check your details and try again.'
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
  const isDemo = !configured
  const authRef = useRef<Auth | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // ── DEMO MODE: restore local demo user session ──────────────────────────
    if (!configured) {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('afterworks_demo_user')
        if (saved) {
          try {
            setUser(JSON.parse(saved))
          } catch {
            // ignore
          }
        }
      }
      setLoading(false)
      return
    }

    // ── FIREBASE PRODUCTION MODE ────────────────────────────────────────────
    let unsub = () => {}
    try {
      const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config)
      const auth = getAuth(app)
      authRef.current = auth

      // Handle redirect result (e.g. from mobile Google sign-in redirect)
      getRedirectResult(auth)
        .then(async (cred) => {
          if (cred?.user) {
            const name = cred.user.displayName || cred.user.email?.split('@')[0] || 'Worker'
            await createUserDocument(cred.user.uid, name, cred.user.email || '')
            setUser(cred.user)
          }
        })
        .catch((err) => {
          console.warn('[Firebase Auth] getRedirectResult failed:', err)
        })

      unsub = onAuthStateChanged(auth, (u) => {
        setUser(u)
        setLoading(false)
      })
    } catch (err) {
      console.error('[Firebase Auth] Failed to initialize Firebase:', err)
      setLoading(false)
    }

    return () => unsub()
  }, [configured, config])

  const value = useMemo<AuthContextValue>(() => {
    // Sign In with email & password
    async function signIn(email: string, password: string): Promise<AuthResult> {
      if (isDemo) {
        // Look up if user previously registered in demo mode
        let foundUser: User | null = null
        if (typeof window !== 'undefined') {
          const accountsJson = localStorage.getItem('afterworks_demo_accounts')
          if (accountsJson) {
            try {
              const accounts = JSON.parse(accountsJson) as Array<{ email: string; user: User }>
              const match = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase())
              if (match) foundUser = match.user
            } catch {
              // ignore
            }
          }
        }

        const activeUser = foundUser || createMockUser(email, email.split('@')[0])
        if (typeof window !== 'undefined') {
          localStorage.setItem('afterworks_demo_user', JSON.stringify(activeUser))
        }
        setUser(activeUser)
        return { ok: true }
      }

      if (!authRef.current) return { ok: false, error: 'Authentication service is not configured.' }
      try {
        const cred = await signInWithEmailAndPassword(authRef.current, email, password)
        setUser(cred.user)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: friendlyError(err) }
      }
    }

    // Sign Up with email, password & name
    async function signUp(
      email: string,
      password: string,
      name: string,
    ): Promise<AuthResult> {
      if (isDemo) {
        const demoUser = createMockUser(email, name || email.split('@')[0])
        if (typeof window !== 'undefined') {
          localStorage.setItem('afterworks_demo_user', JSON.stringify(demoUser))
          // Save in list of demo accounts
          try {
            const accounts = JSON.parse(localStorage.getItem('afterworks_demo_accounts') || '[]')
            accounts.push({ email, user: demoUser })
            localStorage.setItem('afterworks_demo_accounts', JSON.stringify(accounts))
          } catch {
            // ignore
          }
        }
        // Create the user profile in local store
        await createUserDocument(demoUser.uid, name || email.split('@')[0], email)
        setUser(demoUser)
        return { ok: true, isNewUser: true }
      }

      if (!authRef.current) return { ok: false, error: 'Authentication service is not configured.' }
      try {
        const cred = await createUserWithEmailAndPassword(authRef.current, email, password)
        if (name) {
          try {
            await updateProfile(cred.user, { displayName: name })
          } catch (profileErr) {
            console.warn('[Firebase Auth] updateProfile displayName error:', profileErr)
          }
        }
        // Persist the user's profile + empty wallet to Firestore
        await createUserDocument(cred.user.uid, name || email.split('@')[0], email)
        const currentUser = authRef.current.currentUser || cred.user
        setUser(currentUser)
        return { ok: true, isNewUser: true }
      } catch (err) {
        return { ok: false, error: friendlyError(err) }
      }
    }

    // Google Sign-In
    async function signInWithGoogle(): Promise<AuthResult> {
      if (isDemo) {
        const googleEmail = 'worker.google@gmail.com'
        const googleName = 'Google Verified Worker'
        const demoUser = createMockUser(googleEmail, googleName, 'google.com')
        if (typeof window !== 'undefined') {
          localStorage.setItem('afterworks_demo_user', JSON.stringify(demoUser))
        }
        await createUserDocument(demoUser.uid, googleName, googleEmail)
        setUser(demoUser)
        return { ok: true, isNewUser: true }
      }

      if (!authRef.current) return { ok: false, error: 'Authentication service is not configured.' }
      try {
        const provider = new GoogleAuthProvider()
        provider.setCustomParameters({ prompt: 'select_account' })
        try {
          const cred = await signInWithPopup(authRef.current, provider)
          const name = cred.user.displayName || cred.user.email?.split('@')[0] || 'Worker'
          await createUserDocument(cred.user.uid, name, cred.user.email || '')
          const currentUser = authRef.current.currentUser || cred.user
          setUser(currentUser)
          const additionalInfo = getAdditionalUserInfo(cred)
          return { ok: true, isNewUser: additionalInfo?.isNewUser ?? false }
        } catch (popupErr: any) {
          // If popup is blocked by the browser, attempt redirect flow
          if (popupErr?.code === 'auth/popup-blocked') {
            console.warn('[Firebase Auth] Popup blocked, attempting redirect...')
            await signInWithRedirect(authRef.current, provider)
            return { ok: true }
          }
          throw popupErr
        }
      } catch (err) {
        return { ok: false, error: friendlyError(err) }
      }
    }

    // Quick sign in as pre-configured demo worker
    async function signInAsDemoUser(asWorker = true): Promise<AuthResult> {
      const demoEmail = asWorker ? 'amara.okoro@afterworks.io' : 'worker@afterworks.io'
      const demoName = asWorker ? 'Amara Okoro' : 'Demo Worker'
      const demoUser = createMockUser(demoEmail, demoName)
      if (typeof window !== 'undefined') {
        localStorage.setItem('afterworks_demo_user', JSON.stringify(demoUser))
      }
      if (!asWorker) {
        await createUserDocument(demoUser.uid, demoName, demoEmail)
      }
      setUser(demoUser)
      return { ok: true }
    }

    async function signOut() {
      if (isDemo) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('afterworks_demo_user')
        }
        setUser(null)
        return
      }

      if (authRef.current) {
        await fbSignOut(authRef.current)
        setUser(null)
      }
    }

    return {
      user,
      loading,
      configured,
      isDemo,
      signIn,
      signUp,
      signInWithGoogle,
      signInAsDemoUser,
      signOut,
    }
  }, [user, loading, configured, isDemo])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within a FirebaseAuthProvider')
  return ctx
}
