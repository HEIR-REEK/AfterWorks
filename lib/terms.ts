/**
 * Terms & Conditions and the Privacy Notice.
 *
 * These are *content*, and they are in a module rather than in a page for three reasons:
 *  • the sign-up form links to the section it is asking about, so a member can read the exact
 *    clause the checkbox refers to without losing their place;
 *  • the acceptance record (`termsAcceptedAt`, `termsVersion`) names a **version**, and a version
 *    is only meaningful if the text it referred to is addressable from code — so a future edit
 *    gets a new version number and the acceptance history stays honest about what was agreed to;
 *  • `/terms` and `/privacy` are the same content, so the footer link and the sign-up checkbox
 *    can never point at different documents.
 *
 * Bump `TERMS_VERSION` whenever the text changes materially. Members are asked to re-accept on
 * their next sign-in once the recorded version is behind.
 */

export const TERMS_VERSION = '2026-09-28'
export const TERMS_EFFECTIVE = '28 September 2026'

/** The legal entity, read from config with a safe default so a page never renders "undefined". */
export const TERMS_ENTITY = 'AfterWorks Inc.'
export const TERMS_CONTACT = 'support@afterworks.io'

export type TermsSection = {
  id: string
  title: string
  paragraphs: string[]
  /** Rendered as a bullet list after the paragraphs. */
  bullets?: string[]
}

export const TERMS_SECTIONS: readonly TermsSection[] = [
  {
    id: 'agreement',
    title: '1. Agreement to these Terms',
    paragraphs: [
      `These Terms & Conditions form a binding agreement between you and ${TERMS_ENTITY} ("AfterWorks", "we", "us") covering your use of the AfterWorks platform, through which we connect people with paid micro-work ("the Platform").`,
      'By creating an account you confirm that you have read, understood and agree to be bound by these Terms and by our Privacy Notice. If you do not agree, do not create an account — the Platform is not available to you on any other basis.',
      'You confirm you are at least 18 years old, or that you have the written authority of a parent or guardian who has agreed to these Terms on your behalf. Accounts registered by anyone under 18 without that authority may be closed without notice.',
    ],
  },
  {
    id: 'accounts',
    title: '2. Accounts, and one account per person',
    paragraphs: [
      'An account is created once, using an email address you control and a mobile phone number you control. Both are permanent identifiers of your account and both must belong to you alone.',
    ],
    bullets: [
      'One email address may be used for exactly one AfterWorks account. One mobile phone number may be used for exactly one AfterWorks account.',
      'You may not create, or help anyone else create, a second account to claim a reward, work, or a referral bonus more than once.',
      'Accounts created in bulk, or whose identity documents do not match, may be suspended or closed, and any credit on them may be reversed.',
      'You are responsible for everything done through your account. Keep your password to yourself, and tell us immediately if you think someone else has access.',
      'We may ask you to re-verify your email or phone number at any time, and may suspend an account whose contact details stop working.',
    ],
  },
  {
    id: 'eligibility',
    title: '3. Identity verification (KYC)',
    paragraphs: [
      'Before you can take paid work or receive a payout we must verify your identity. Verification is carried out by our identity-verification provider; you upload your document directly to them, and the document itself is not stored on AfterWorks servers — we keep only the outcome and the reference.',
      'We record that you were verified, when, and by which provider. If verification is declined, put on hold, or later revoked, the account returns to the corresponding restricted state: applications stop, withdrawals stop, and any referral code stops working.',
    ],
  },
  {
    id: 'work',
    title: '4. Finding and completing work',
    paragraphs: [
      'Job listings are invitations to apply, not guarantees of work. We decide which applications to accept. You may only hold one active application per job, and you may not apply to a job you are not eligible for.',
      'When you are accepted, you must complete the work to the standard the listing requires and submit it by the deadline. Work that fails quality review may be returned for revision; repeated failure lowers your quality score, which affects which work you are offered.',
    ],
    bullets: [
      'Do not submit work that is not your own, copied from another worker, or produced with automated tools where the listing prohibits them.',
      'Never share a client’s data outside the Platform, and remove it once the assignment ends.',
      'Do not contact clients directly, or attempt to take an assignment off-platform.',
    ],
  },
  {
    id: 'earnings',
    title: '5. Earnings, clearing and withdrawals',
    paragraphs: [
      'Approved work is credited to your pending balance immediately. Pending earnings sit through a clearing window so that a client can raise a quality issue before money leaves the Platform. After clearing they move to your available balance.',
      'You may request a withdrawal once your withdrawable balance reaches the minimum withdrawal amount. A request claims the amount you asked for (shown as "held") until it is paid, rejected or cancelled, and you may only have one request open at a time.',
      'Withdrawals are paid to payout details in your own name only. A payout to a number or account belonging to someone else is not a withdrawal and cannot be recovered.',
      'We convert to your local currency at the rate shown on the Platform at the moment the payout is processed, and that rate may differ from the rate displayed at the moment you requested it.',
    ],
  },
  {
    id: 'rewards',
    title: '6. Welcome and referral rewards',
    paragraphs: [
      'We may offer a welcome reward for completing your profile, and a referral reward for each person you successfully refer. These are promotional credits, not wages, and we may change, reduce or withdraw them prospectively — but never from an account that has already qualified.',
      'The full referral rules — including when a referral qualifies, the weekly limit, the identity requirement, and the anti-abuse measures — are set out in the Referral Program section below and form part of these Terms.',
    ],
    bullets: [
      'A reward is credited once per qualifying event and never twice, however many times a page is reloaded or a request retried.',
      'Reward money clears and withdraws exactly like earned money: it is not instant, and it is not a top-up of a balance you may spend immediately.',
      'Rewards may be reversed if the account that earned them is found to be fraudulent, duplicated, or in breach of these Terms.',
    ],
  },
  {
    id: 'acceptable-use',
    title: '7. Acceptable use',
    paragraphs: ['You agree not to:'],
    bullets: [
      'Use the Platform for anything unlawful, or to harass, defraud or exploit any client, worker or member.',
      'Attempt to access another person’s account, documents, wallet or referral code.',
      'Scrape, reverse-engineer, overload, or interfere with the Platform or its APIs.',
      'Circumvent the clearing window, the one-request-at-a-time rule, the weekly referral limit, or any other limit we set.',
      'Sell, rent or share your account or referral code as though it were a product.',
    ],
  },
  {
    id: 'suspension',
    title: '8. Suspension, closure and disputes',
    paragraphs: [
      'We may suspend or close an account that breaches these Terms, that fails verification, or that we reasonably believe is fraudulent. Where money is involved we explain what happened, and a suspension that turns out to be a mistake is reversed along with any credit it removed.',
      'If you disagree with a decision, write to us at the address below with your account email and the decision. We aim to respond within 14 days.',
    ],
  },
  {
    id: 'changes',
    title: '9. Changes to these Terms',
    paragraphs: [
      'We may update these Terms. The version number and effective date at the top of this page always identify the text that applies. When a change is material we will ask you to accept the new version before you continue using the Platform, and your account will record which version you accepted and when.',
    ],
  },
  {
    id: 'contact',
    title: '10. Contact',
    paragraphs: [
      `Questions about these Terms: ${TERMS_CONTACT}.`,
      `Registered entity: ${TERMS_ENTITY}.`,
    ],
  },
] as const

export const PRIVACY_SECTIONS: readonly TermsSection[] = [
  {
    id: 'what-we-collect',
    title: 'What we collect',
    paragraphs: [
      'We collect only what the Platform needs to pay you and to keep the account secure:',
    ],
    bullets: [
      'Account details: your name, email address, mobile phone number, country, and the phone number you are paid to.',
      'Profile details: your location, summary, skills, languages, and the education and work history you choose to add.',
      'Verification outcome: that you were verified, when, by which provider, and any reason a check was not passed. We never receive or store your identity document, biometric template or selfie — those go directly to our verification provider.',
      'Work activity: the jobs you apply for, the work you submit, quality outcomes and payment history.',
      'Security records: sign-in events, failed sign-in attempts, session and device information, and the audit log of actions taken on your account.',
      'Referral activity: a referral code, and the fact that an account signed up with it and completed a profile. We do not show one member another member’s email address.',
    ],
  },
  {
    id: 'how-we-use',
    title: 'How we use it',
    paragraphs: [
      'To run the Platform: match you to work, calculate and pay what you earn, verify your identity, and answer support requests. To keep it safe: detect duplicate accounts, referral farming and payment fraud. To meet our legal and tax obligations. And to tell you about changes that affect you.',
      'We do not sell your personal information, and we do not use your work history to build advertising profiles.',
    ],
  },
  {
    id: 'sharing',
    title: 'Who we share it with',
    paragraphs: [
      'We share the minimum necessary with the providers that run the Platform for us:',
    ],
    bullets: [
      'Identity verification providers, who receive your document and selfie directly and return only an outcome to us.',
      'Mobile money and banking partners, who receive your name and the account number you are paid to at the moment of a payout.',
      'Cloud hosting and database providers, who store it under contract and on our instructions.',
      'Professional advisers and authorities, where we are legally required to disclose it.',
    ],
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    paragraphs: [
      'Profile and security data is kept while your account is open. Financial records — earnings, payouts and their references — are kept for as long as tax and anti-money-laundering rules require, because a payout record without a counterparty is worse for you than a retained one. Security logs are kept for a limited period and then deleted.',
    ],
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    paragraphs: [
      'You can see and correct your profile at any time from the Profile page. You can ask us for a copy of the personal data we hold about you, ask us to correct it, or ask us to delete your account.',
      'We will keep financial and audit records we are legally required to retain, and will tell you exactly what we kept and why. Write to the address below and we will respond within 30 days.',
    ],
  },
  {
    id: 'cookies',
    title: 'Cookies and local storage',
    paragraphs: [
      'We use a session cookie to keep you signed in, and local storage for interface preferences such as which onboarding prompts you have already dismissed. We do not use advertising or cross-site tracking cookies.',
    ],
  },
] as const

/** Deep link to one section, used by the sign-up checkboxes and the referral panel. */
export function termsHref(sectionId?: string): string {
  return sectionId ? `/terms#${sectionId}` : '/terms'
}

export function privacyHref(sectionId?: string): string {
  return sectionId ? `/privacy${sectionId ? `#${sectionId}` : ''}` : '/privacy'
}
