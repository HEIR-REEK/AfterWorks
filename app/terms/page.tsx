import type { Metadata } from 'next'
import { LegalDocument } from '@/components/legal-document'
import { TERMS_ENTITY, TERMS_SECTIONS, TERMS_VERSION, type TermsSection } from '@/lib/terms'
import { REFERRAL_BONUS_LABEL, REFERRAL_TERMS } from '@/lib/referrals'

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description:
    'The terms that govern use of the AfterWorks platform: accounts, identity verification, earnings, withdrawals, the referral program and acceptable use.',
  alternates: { canonical: '/terms' },
}

/**
 * The referral rules get their own numbered section rather than a bullet, because a member
 * deciding whether to share a link deserves to read exactly what the link does.
 *
 * They are rendered from `REFERRAL_TERMS` in `lib/referrals` — the same constants the server
 * enforces when it credits the bonus — so this page cannot advertise a reward the code does not
 * pay, or a weekly limit the server does not apply. That is why the section is assembled here
 * rather than typed into `lib/terms.ts`.
 */
const REFERRAL_SECTION: TermsSection = {
  id: 'referrals',
  title: '6A. The referral program',
  paragraphs: [
    `You can invite people to AfterWorks with your personal referral code. When someone signs up with your code and completes their profile, ${REFERRAL_BONUS_LABEL} is added to your pending balance. There is no cap on how many people you can refer, but every referral must be a real person who really signed up.`,
    'The bonus clears into your available balance on the same schedule as paid work, and it is withdrawable once it has cleared and you have reached the minimum withdrawal amount.',
  ],
  bullets: REFERRAL_TERMS.map((term) => `${term.title}. ${term.body}`),
}

// Section 6 ("Welcome and referral rewards") is the summary; this is the full rulebook, so it
// sits directly after it rather than at the end where nobody would find it.
const PAGE_SECTIONS: readonly TermsSection[] = [
  ...TERMS_SECTIONS.slice(0, 6),
  REFERRAL_SECTION,
  ...TERMS_SECTIONS.slice(6),
]

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms & Conditions"
      version={TERMS_VERSION}
      intro={`These terms form the agreement between you and ${TERMS_ENTITY} for using the AfterWorks platform. They are the same document you accept when you create an account, and the version below is the one recorded against your account. Our Privacy Notice describes how your personal data is handled.`}
      sections={PAGE_SECTIONS}
    />
  )
}
