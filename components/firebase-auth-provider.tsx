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
import { useRouter } from 'next/navigation'

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
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string, name: string) => Promise<AuthResult>
  signInWithGoogle: () => Promise<AuthResult>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isConfigComplete(config: FirebaseConfig) {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)
}

// Maps Firebase error codes to friendly, worker-facing messages for production.
export function friendlyError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  const message = (err as { message?: string })?.message ?? ''

  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists. Please sign in instead.'
    case 'auth/weak-password':
      return 'Password is too weak. Please use at least 6 characters.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Incorrect email or password.'
    case 'auth/user-not-found':
      return 'No account found with this email address. Please create an account.'
    case 'auth/too-many-requests':
      return 'Access to this account has been temporarily disabled due to many failed attempts. Please try again in a few minutes or reset your password.'
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection and try again.'
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled before completion.'
    case 'auth/popup-blocked':
      return 'The sign-in popup was blocked by your browser. Please allow popups for this site, or try again.'
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Console. Please add this domain under Firebase Authentication → Settings → Authorized domains.'
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled in Firebase. Please enable Google provider under Firebase Authentication → Sign-in method.'
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email address using a different sign-in method. Please sign in with your email and password.'
    case 'auth/cancelled-popup-request':
      return 'Another sign-in window was already open. Please try again.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.'
    case 'auth/requires-recent-login':
      return 'This operation is sensitive and requires recent authentication. Please sign in again.'
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
  const router = useRouter()
  const configured = isConfigComplete(config)
  const authRef = useRef<Auth | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(configured)

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }

    let unsub = () => {}
    try {
      const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config)
      const auth = getAuth(app)
      authRef.current = auth

      // Handle redirect return result (e.g. mobile Google sign-in redirect)
      getRedirectResult(auth)
        .then(async (cred) => {
          if (cred?.user) {
            const name = cred.user.displayName || cred.user.email?.split('@')[0] || 'Worker'
            await createUserDocument(cred.user.uid, name, cred.user.email || '')
            setUser(cred.user)
            const additionalInfo = getAdditionalUserInfo(cred)
            if (additionalInfo?.isNewUser) {
              router.push('/profile?new=1')
            } else {
              router.push('/')
            }
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
  }, [configured, config, router])

  const value = useMemo<AuthContextValue>(() => {
    // Sign In with email & password
    async function signIn(email: string, password: string): Promise<AuthResult> {
      if (!authRef.current) {
        return {
          ok: false,
          error: 'Authentication service is not configured. Please check your Firebase configuration.',
        }
      }
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
      if (!authRef.current) {
        return {
          ok: false,
          error: 'Authentication service is not configured. Please check your Firebase configuration.',
        }
      }
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

    // Google Sign-In with popup + redirect fallback
    async function signInWithGoogle(): Promise<AuthResult> {
      if (!authRef.current) {
        return {
          ok: false,
          error: 'Authentication service is not configured. Please check your Firebase configuration.',
        }
      }
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
          // If popup is blocked by browser, attempt redirect flow
          if (
            popupErr?.code === 'auth/popup-blocked' ||
            popupErr?.code === 'auth/cancelled-popup-request'
          ) {
            console.warn('[Firebase Auth] Popup blocked or cancelled, attempting redirect...')
            await signInWithRedirect(authRef.current, provider)
            return { ok: true }
          }
          throw popupErr
        }
      } catch (err) {
        return { ok: false, error: friendlyError(err) }
      }
    }

    async function signOut() {
      if (authRef.current) {
        await fbSignOut(authRef.current)
        setUser(null)
      }
    }

    return {
      user,
      loading,
      configured,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
    }
  }, [user, loading, configured])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within a FirebaseAuthProvider')
  return ctx
}
