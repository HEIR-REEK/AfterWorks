import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { FirebaseAuthProvider, type FirebaseConfig } from '@/components/firebase-auth-provider'
import { AppGate } from '@/components/app-gate'
import './globals.css'

// Firebase web config values are safe to expose to the client, but the project
// stores them as server-only env vars (no NEXT_PUBLIC_ prefix), so we read them
// in this Server Component and pass them down to the client auth provider.
const firebaseConfig: FirebaseConfig = {
  apiKey: process.env.FIREBASE_WEB_API_KEY ?? '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.FIREBASE_PROJECT_ID ?? '',
  appId: process.env.FIREBASE_APP_ID ?? '',
}

// `Geist` font is not available from next/font/google; use Inter and JetBrains Mono
const geistSans = Inter({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'AfterWorks — Find verified microwork & get paid',
  description:
    'AfterWorks connects verified workers with real, paid microwork. Browse jobs, track your applications, and get paid to your mobile money — no fees to apply.',
  generator: 'v0.app',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#2f5fe0',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`light bg-background ${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">
        <FirebaseAuthProvider config={firebaseConfig}>
          <AppGate>{children}</AppGate>
        </FirebaseAuthProvider>
      </body>
    </html>
  )
}
