import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { FirebaseAuthProvider, type FirebaseConfig } from '@/components/firebase-auth-provider'
import { AppGate } from '@/components/app-gate'
import { getCachedMaintenanceStatus } from '@/lib/maintenance-shared'
import { site } from '@/lib/site'
import { env, envBool, isProduction } from '@/lib/security-core'

// Self-hosted variable fonts (Inter + JetBrains Mono) shipped inside the bundle.
// Why not next/font/google: it fetches from Google at *build* time (a network dependency that
// fails offline builds), adds a third-party origin to the CSP, and costs an extra round trip for
// first-time visitors. Self-hosting removes all three and lets the fonts be cached by us.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './globals.css'

// Firebase web config values are safe to expose to the client, but the project stores them as
// server-only env vars (no NEXT_PUBLIC_ prefix), so we read them in this Server Component and pass
// them to the client provider. Nothing privileged is ever read here.
function readFirebaseConfig(): FirebaseConfig {
  return {
    apiKey:
      process.env.FIREBASE_WEB_API_KEY ||
      process.env.FIREBASE_API_KEY ||
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      process.env.NEXT_PUBLIC_FIREBASE_WEB_API_KEY ||
      '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    appId: process.env.FIREBASE_APP_ID || process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  }
}

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const base = {
    title: {
      default: `${site.name} — ${site.tagline}`,
      template: `%s · ${site.name}`,
    },
    description: site.description,
    metadataBase: new URL(site.url.startsWith('http') ? site.url : 'https://afterworks.io'),
    applicationName: site.name,
    generator: 'AfterWorks',
    keywords: [
      'microwork',
      'paid transcription jobs',
      'data entry jobs Kenya',
      'mobile money payouts',
      'verified remote work',
      'AfterWorks',
    ],
    authors: [{ name: `${site.name} Operations`, url: site.url }],
    creator: site.name,
    publisher: site.legalName,
    category: 'work',
    openGraph: {
      type: 'website',
      siteName: site.name,
      title: `${site.name} — ${site.tagline}`,
      description: site.description,
      url: site.url,
      images: [{ url: '/brand/opengraph.png', width: 1200, height: 630, alt: `${site.name} — verified microwork` }],
      locale: 'en_KE',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${site.name} — ${site.tagline}`,
      description: site.description,
      creator: '@afterworks',
    },
    robots: {
      index: !isProduction(),
      follow: true,
      googleBot: { index: false, follow: true, 'max-image-preview': 'large' },
    },
    alternates: { canonical: '/' },
    icons: {
      icon: [{ url: '/icon.png', type: 'image/png', sizes: '64x64' }],
      apple: '/apple-icon.png',
    },
    manifest: '/manifest.webmanifest',
  } satisfies Metadata

  // While a blackout window is running, keep bots off the interim pages and stop reindex churn.
  const { status } = await getCachedMaintenanceStatus()
  if (status.active) {
    return {
      ...base,
      title: `${status.config.title} — ${site.name}`,
      robots: { index: false, follow: false },
    }
  }
  return base
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#2f5fe0',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5, // was 1/userScalable:false — that is a WCAG 1.4.4 failure for low-vision workers
  interactiveWidget: 'resizes-content',
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const config = readFirebaseConfig()
  const headerList = await headers()
  const maintenanceMode = headerList.get('x-afterworks-maintenance-mode') ?? 'off'
  const requestId = headerList.get('x-request-id') ?? undefined
  const noIndex = envBool('SITE_NO_INDEX', !isProduction())

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: site.name,
    legalName: site.legalName,
    url: site.url,
    email: site.supportEmail,
    description: site.description,
    areaServed: ['KE', 'UG', 'TZ', 'RW', 'NG', 'ZA'],
    sameAs: [site.twitter, site.linkedin],
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: site.supportEmail,
        availableLanguage: ['English', 'Swahili'],
      },
    ],
  }

  return (
    <html
      lang="en"
      className="light bg-background"
      data-maintenance={maintenanceMode}
      data-build={env('APP_VERSION') || 'dev'}
    >
      <head>
        {noIndex ? <meta name="robots" content="noindex, nofollow" /> : null}
        <meta name="color-scheme" content="light" />
        <link rel="preconnect" href="https://firestore.googleapis.com" />
        <link rel="preconnect" href="https://identitytoolkit.googleapis.com" />
        {requestId ? <meta name="x-request-id" content={requestId} /> : null}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body className="font-sans antialiased">
        <FirebaseAuthProvider config={config}>
          <AppGate>{children}</AppGate>
        </FirebaseAuthProvider>
      </body>
    </html>
  )
}
