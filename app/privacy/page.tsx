import type { Metadata } from 'next'
import { LegalDocument } from '@/components/legal-document'
import { PRIVACY_SECTIONS, TERMS_VERSION } from '@/lib/terms'

export const metadata: Metadata = {
  title: 'Privacy Notice',
  description:
    'What AfterWorks collects, why we collect it, who we share it with, how long we keep it and how to exercise your rights.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Notice"
      version={TERMS_VERSION}
      intro="This notice explains what personal data AfterWorks holds about you, why we hold it, who else sees it, and what you can ask us to do about it. It is accepted at the same time as our Terms & Conditions."
      sections={PRIVACY_SECTIONS}
    />
  )
}
