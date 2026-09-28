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
  | { ok: true; isNewUser?: boolean; needsEmailVerification?: boolean; referredBy?: string }
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
  /**
   * Google popup. `allowSignUp` must be false on the sign-in page: Google would otherwise mint an
   * account for a first-time visitor who was only trying to sign in, which is exactly the "no
   * account, no entry" rule the platform promises. On the sign-up page it is true, because there the
   * person has explicitly asked for an account.
   */
  signInWithGoogle: (options?: { allowSignUp?: boolean }) => Promise<AuthResult>
  signOut: () => Promise<void>
  /** Re-sends a Resend verification email to the currently signed-in (but unverified) user. */
  resendVerification: () => Promise<{ ok: boolean; error?: string; alreadyVerified?: boolean }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Where a `?ref=` code waits between page loads. Session-scoped: it dies with the tab. */
const REFERRAL_STORAGE_KEY = 'afterworks:ref'

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

    /**
     * Is this account's inbox proven — *right now*, according to Auth?
     *
     * The `User` object handed back by `signInWith*` carries a snapshot taken when its ID token
     * was minted, and that snapshot is the reason Google sign-ups were being pushed onto the
     * verification screen: a Firebase record whose address Google has already confirmed can still
     * read `emailVerified: false` on a token issued moments earlier (the account was created with
     * a password first, or the record was updated on another device), and the gate then treats a
     * verified member as unverified and bounces them.
     *
     * The fix is to ask the one source that cannot be stale: refresh the ID token, whose
     * `email_verified` claim is read from the Auth record at mint time. `reload()` first so the
     * `User` object agrees, and both calls are allowed to fail — a network blip must not turn a
     * good sign-in into an error, so the local flag is the fallback.
     */
    async function isEmailVerifiedNow(u: User): Promise<boolean> {
      try {
        await u.reload()
        const result = await u.getIdTokenResult(true)
        const claim = result.claims?.email_verified
        if (typeof claim === 'boolean') return claim
        return u.emailVerified === true
      } catch {
        return u.emailVerified === true
      }
    }

    async function signIn(email: string, password: string): Promise<AuthResult> {
      if (!authRef.current) {
        return { ok: false, error: 'Authentication is not configured on this deployment.', code: 'auth/configuration-not-found' }
      }
      try {
        const cred = await signInWithEmailAndPassword(authRef.current, email, password)
        // Publish the session *before* the network round trip below, or the app gate sees a null
        // user for its duration and bounces a perfectly good sign-in to /sign-in.
        setUser(cred.user)
        // A returning member who verified on another device must not be sent back to
        // /verify-email by a stale flag, and an unverified one must still be held at the gate.
        const verified = await isEmailVerifiedNow(cred.user)
        // `reload()` updated the object in place, so re-publish it: this is what the gate reads.
        setUser(authRef.current?.currentUser ?? cred.user)
        if (!verified) {
          // Keep the session so they can resend from /verify-email; the app gate blocks profile/KYC.
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
        // Everything below is best-effort bookkeeping. The account exists and works; a failed
        // referral, terms or terms record must never turn a successful sign-up into an error.
        const referredBy = await attachReferral(cred.user)
        await recordTermsAcceptance(cred.user)
        return {
          ok: true,
          isNewUser: true,
          needsEmailVerification: !cred.user.emailVerified,
          ...(referredBy ? { referredBy } : {}),
        }
      } catch (err) {
        const code = firebaseErrorCode(err)
        return { ok: false, error: friendlyError(code), code }
      }
    }

    /**
     * Reads `?ref=` once and remembers it for the rest of the browser session.
     *
     * Session storage, not a ref: the code is read on the sign-up page and consumed on the same
     * page, but a member can bounce through Google's popup and back, and losing the attribution
     * to a navigation would quietly cost somebody $3.
     */
    function readReferralCode(): string | null {
      if (typeof window === 'undefined') return null
      try {
        const fromUrl = new URLSearchParams(window.location.search).get('ref')
        if (fromUrl) {
          window.sessionStorage.setItem(REFERRAL_STORAGE_KEY, fromUrl)
          return fromUrl
        }
        return window.sessionStorage.getItem(REFERRAL_STORAGE_KEY)
      } catch {
        return null
      }
    }

    /** Consumes the stored code and posts it. Never throws. */
    async function attachReferral(user: User): Promise<string | null> {
      const code = readReferralCode()
      if (!code) return null
      try {
        const token = await user.getIdToken()
        const res = await fetch('/api/referrals/claim', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ code, name: user.displayName ?? '', email: user.email ?? '' }),
          cache: 'no-store',
        })
        const data = (await res.json().catch(() => ({}))) as { attached?: boolean; reason?: string }
        if (res.ok && data.attached) {
          // One shot: a reload must not try to re-attribute the same account.
          try {
            window.sessionStorage.removeItem(REFERRAL_STORAGE_KEY)
          } catch {
            /* storage blocked */
          }
          return code
        }
        if (data.reason && data.reason !== 'no_referral_code') {
          console.info('[referral] not attached:', data.reason)
        }
        return null
      } catch (err) {
        console.warn('[referral] claim skipped:', err instanceof Error ? err.message : err)
        return null
      }
    }

    /**
     * Records the Terms & Privacy acceptance server-side. The boxes were ticked in the form; this
     * only reports that, and the server owns the timestamp and the version.
     */
    async function recordTermsAcceptance(user: User): Promise<boolean> {
      try {
        const token = await user.getIdToken()
        const res = await fetch('/api/auth/terms', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ terms: true, privacy: true }),
          cache: 'no-store',
        })
        return res.ok
      } catch (err) {
        console.warn('[terms] acceptance not recorded:', err instanceof Error ? err.message : err)
        return false
      }
    }

    async function signOut() {
      if (authRef.current) await fbSignOut(authRef.current)
    }

    async function signInWithGoogle(options?: { allowSignUp?: boolean }): Promise<AuthResult> {
      if (!authRef.current) {
        return { ok: false, error: 'Authentication is not configured on this deployment.', code: 'auth/configuration-not-found' }
      }
      const allowSignUp = options?.allowSignUp !== false
      try {
        const provider = new GoogleAuthProvider()
        provider.setCustomParameters({ prompt: 'select_account' })
        const cred = await signInWithPopup(authRef.current, provider)
        const additionalInfo = getAdditionalUserInfo(cred)

        /**
         * A first-time Google visitor arriving through sign-in gets no account here.
         *
         * The popup has already created the credential inside Firebase Auth by the time we can look
         * at it, so the account cannot be "refused" at the provider — but we can refuse to admit it:
         * no profile document is written, the session is dropped immediately, and the visitor is sent
         * to create the account deliberately. (Firebase Console → Authentication → Sign-in method →
         * Google → disable "Enable create account" closes the loop at the provider too.)
         */
        if (!allowSignUp && additionalInfo?.isNewUser) {
          await fbSignOut(authRef.current)
          setUser(null)
          return {
            ok: false,
            code: 'auth/account-created-instead-of-signed-in',
            error: 'That Google account has no AfterWorks account yet, so you were not signed in. Create the account first — it takes a minute, and your earnings then stay attached to it.',
          }
        }

        const name = cred.user.displayName || cred.user.email?.split('@')[0] || 'Worker'
        // Ask Auth *before* writing the profile: Google has normally already proven the address,
        // and the document must record what is true rather than a blanket "not yet".
        const googleVerified = await isEmailVerifiedNow(cred.user)
        await createUserDocument(cred.user.uid, name, cred.user.email || '', { emailVerified: googleVerified })
        setUser(cred.user)
        // Only for an account that did not exist a moment ago. `additionalInfo.isNewUser` is
        // Firebase's own answer to "was this a sign-up or a sign-in", and it matters here in a way
        // it does not elsewhere: this branch also runs for returning members, and replaying the
        // terms call for them would rewrite the acceptance timestamp every time they signed in,
        // turning "the moment this person accepted" into "the last time they logged in". It would
        // also let a returning member claim a referral link that happened to be in the session.
        if (additionalInfo?.isNewUser) {
          // A Google sign-up through somebody's referral link is still a referral. Best effort —
          // never fails the sign-in.
          await attachReferral(cred.user)
          await recordTermsAcceptance(cred.user)
        }
        // Google has already proven the address it vouched for, so the *record* almost always
        // says verified. Ask the record rather than the snapshot on the credential we were handed
        // — reading the snapshot is what used to send a brand-new Google member to the
        // verification screen for an inbox Google had already confirmed.
        if (!googleVerified) {
          try {
            const token = await cred.user.getIdToken()
            await requestVerificationEmail(token)
          } catch {
            /* resend is available on /verify-email */
          }
          setUser(authRef.current?.currentUser ?? cred.user)
          return { ok: true, isNewUser: additionalInfo?.isNewUser ?? false, needsEmailVerification: true }
        }
        setUser(authRef.current?.currentUser ?? cred.user)
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
