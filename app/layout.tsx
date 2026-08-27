import type { Metadata, Viewport } from 'next'
import { FirebaseAuthProvider, type FirebaseConfig } from '@/components/firebase-auth-provider'
import { AppGate } from '@/components/app-gate'
import './globals.css'

// Firebase web config values: accept standard, NEXT_PUBLIC_, and server-only variants.
const firebaseConfig: FirebaseConfig = {
  apiKey:
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    process.env.NEXT_PUBLIC_FIREBASE_WEB_API_KEY ||
    '',
  authDomain:
    process.env.FIREBASE_AUTH_DOMAIN ||
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    '',
  projectId:
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    '',
  appId:
    process.env.FIREBASE_APP_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
    '',
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    '',
  messagingSenderId:
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
    '',
}

export const metadata: Metadata = {
  title: 'AfterWorks — Find verified microwork & get paid',
  description:
    'AfterWorks connects verified workers with real, paid microwork. Browse jobs, track your applications, and get paid to your mobile money — no fees to apply.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#2f5fe0',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="light bg-background">
      <body className="font-sans antialiased">
        <FirebaseAuthProvider config={firebaseConfig}>
          <AppGate>{children}</AppGate>
        </FirebaseAuthProvider>
      </body>
    </html>
  )
}
