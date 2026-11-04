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
 * Bump `TERMS_VERSION` whenever the text changes materially, so the acceptance record names the
 * text the member actually agreed to. A material change should be notified and, where required,
 * re-accepted; the current version is never presented as the one an older account accepted.
 *
 * These documents describe the platform that actually exists in this repository: Firebase Auth and
 * Firestore, manual identity review, Paystack training payments, Resend transactional email,
 * a wallet with a clearing window and mobile-money/bank payouts. Keep that mapping when editing —
 * a clause that promises a process the code does not run is worse than no clause at all.
 */

import { site } from '@/lib/site'

export const TERMS_VERSION = '2026-11-02'
export const TERMS_EFFECTIVE = '2 November 2026'

/** The legal entity, read from config with a safe default so a page never renders "undefined". */
export const TERMS_ENTITY = 'AfterWorks Inc.'
export const TERMS_CONTACT = site.supportEmail

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
    title: '1. Who we are, and what these Terms cover',
    paragraphs: [
      `These Terms & Conditions form a binding agreement between you and ${TERMS_ENTITY} ("AfterWorks", "we", "us", "our") covering your use of the AfterWorks platform at afterworks.site, including the worker workspace, job board, training modules, wallet and any related services (together, "the Platform").`,
      'By creating an account, ticking the acceptance boxes or using the Platform, you confirm that you have read, understood and agree to be bound by these Terms and by our Privacy Notice. If you do not agree, do not create an account or use the Platform.',
      'You must be at least 18 years old to hold an account. If you are under 18, you may only use the Platform with the written authority of a parent or guardian who agrees to these Terms on your behalf. We may close an account that does not meet this requirement.',
      'Nothing in these Terms excludes or limits any statutory right you have that cannot lawfully be excluded, including consumer-protection rights that apply where you live.',
    ],
  },
  {
    id: 'accounts',
    title: '2. Eligibility and your account',
    paragraphs: [
      'An account is created once, using an email address you control and a mobile phone number you control. Your email address and mobile number are the primary identifiers of the account and must belong to you alone.',
      'You agree to give accurate, current information, to keep it up to date, and to complete the email-verification step before using the parts of the Platform that require it. We may ask you to re-verify your email address or phone number at any time.',
    ],
    bullets: [
      'One email address may be used for exactly one AfterWorks account, and one mobile phone number may be used for exactly one AfterWorks account.',
      'You may not create, or help anyone else create, a second account to claim work, a welcome reward, a referral bonus or any other benefit more than once.',
      'You may not sell, rent, lend or share your account, password, session or referral code with another person.',
      'You are responsible for everything done through your account. Tell us immediately if you believe someone else has access to it, and change your password.',
      'We may suspend an account whose contact details stop working, whose owner cannot be verified, or which we reasonably believe is being used by someone other than its owner.',
    ],
  },
  {
    id: 'eligibility',
    title: '3. Identity verification (KYC)',
    paragraphs: [
      'Before you can start training, take an assessment, take paid work or receive a payout, you must complete identity verification. Verification is carried out by our own review team: you request it from your profile, our team reviews the information you provide, and the decision is recorded against your account. We keep the outcome, the date it was decided, and any reason a check was declined or requires another look. You may pay a job card’s training fee before verification, but the training material and assessment for that card stay locked until the check is approved.',
      'We may also carry out checks required by sanctions, anti-money-laundering and counter-terrorism-financing rules. We may decline an application, delay a payout or ask for more information where a check is incomplete or inconsistent.',
      'If verification is declined, placed on hold or later revoked, your account moves to the corresponding restricted state. Applications stop, withdrawals stop, and your referral code stops working. You may ask for another review once you have corrected the problem, and you may ask us to review a verification decision by contacting the address in section 17.',
    ],
  },
  {
    id: 'engagement',
    title: '4. Working with AfterWorks',
    paragraphs: [
      'You provide your services as an independent contractor. Nothing in these Terms creates an employment, agency, partnership or joint-venture relationship between you and AfterWorks, a client, or any other worker. You are not entitled to employment benefits, paid leave, notice pay or severance from AfterWorks.',
      'You decide when and where to work, subject to the requirements of each job card and its deadline. You are responsible for your own equipment, internet connection, workspace and any costs you incur in completing work.',
      'AfterWorks does not guarantee any volume of work, any particular job, any rate of pay or any minimum earnings. Job availability depends on client demand, your verification status, your quality score and the capacity shown on each card. You are free to decline or ignore any job you do not want.',
    ],
  },
  {
    id: 'work',
    title: '5. Jobs, applications, assessments and training',
    paragraphs: [
      'A job listing is an invitation to apply, not an offer of work. AfterWorks or the client decides which applications to accept, and may close, pause or change a listing while it is open. You may hold only one active application for the same job, and you must not apply for a job you are not eligible to perform.',
      'Each job card states the fee, the estimated time, the number of slots, the deadline and whether a training module is required. Some jobs require a short paid training module and a passing assessment before you can submit work. The training fee is shown before you pay, is charged per job, and reserves that job card’s training place. You may pay it before identity verification. The training material and assessment are unlocked only after your identity verification is approved; paying does not bypass that check. Once access has been granted, that fee is non-refundable except where the law requires a refund or where we cancel the job before you begin. If verification is declined and you cannot access the training, contact support to request a refund of a fee paid for training you could not access because verification was declined.',
      'You must read the brief and any instructions attached to the job before accepting it. If you are unsure whether you meet the requirements, ask support before paying for training or starting the work.',
    ],
  },
  {
    id: 'quality',
    title: '6. Doing the work: standards, quality review and revisions',
    paragraphs: [
      'You must complete work yourself, follow the brief and the style guide, and submit it before the deadline. Work that is copied, fabricated, produced by tools the brief prohibits, or completed by somebody else is a breach of these Terms and may be rejected without payment.',
      'Submissions are reviewed for quality before they are accepted. If a submission does not meet the brief, you may be given the reason and a revision window in which to correct it. Repeated failures, missed deadlines or ignored revision requests can lower your quality score and affect the work you are offered.',
      'You are responsible for the accuracy of your submission and for keeping any working copies you need. Once work is accepted and paid, the client may use it as described in section 10.',
    ],
    bullets: [
      'Do not share client data, files or credentials with anyone outside the Platform.',
      'Do not contact a client directly, or move a task or payment off the Platform.',
      'Do not submit unlawful, defamatory, infringing or harmful content, and do not use a task to collect personal data you were not asked to collect.',
    ],
  },
  {
    id: 'earnings',
    title: '7. Earnings, the wallet, clearing and withdrawals',
    paragraphs: [
      'When a submission is accepted and marked complete, the job fee is credited to your pending balance. Pending earnings sit through a clearing window — the period shown in your wallet before they become available — so a client or our quality team can raise a problem before money leaves the Platform. After the clearing window, the money moves to your available balance.',
      'You may request a withdrawal once your available balance reaches the minimum withdrawal amount shown on the Platform. A request claims the amount you asked for and shows it as held; you may only have one withdrawal request open at a time. A request may be held, delayed or returned to your balance while we check it, verify your payout details, or resolve a quality or fraud issue.',
      'Withdrawals are paid only to payout details in your own name: an M-Pesa number registered to you for Kenyan payouts, or a bank account in your name. A payout sent to an account belonging to somebody else is not a valid withdrawal and may not be recoverable. We may ask for proof that the destination belongs to you.',
      'Amounts are converted at the rate applied when the payout is processed, which may differ from the rate displayed when you requested it. The payout target shown on the Platform is a target, not a guarantee: mobile-money and banking partners can take longer, and their own cut-off times apply.',
      'We may correct a balance or reverse a credit where a payment was made in error, duplicated, charged back, obtained by fraud, or where work is later found not to have been completed in accordance with the brief. Where we do this, we tell you what changed and why.',
    ],
  },
  {
    id: 'rewards',
    title: '8. Rewards, referrals and promotions',
    paragraphs: [
      'We may offer promotional credits, including a welcome reward for completing your profile and a referral reward for introducing a new member. Promotional credits are not wages. They are paid once per qualifying event, cannot be claimed by the same person twice, and may be cancelled, reduced or changed for future events.',
      'The full referral rules — when a referral qualifies, the weekly limit, the identity requirement and the anti-abuse measures — are set out in the Referral Program section below and form part of these Terms.',
    ],
    bullets: [
      'A reward is credited once per qualifying event and never twice, however many times a page is reloaded or a request retried.',
      'A referral reward is credited to your pending balance and clears on the same schedule as paid work. The welcome reward is released to your available balance once your profile is complete. All promotional credits can be withdrawn once they are available and you have reached the minimum withdrawal amount.',
      'Rewards may be reversed where the account that earned them is fraudulent, duplicated, or in breach of these Terms, or where the referred account is not a genuine new member.',
    ],
  },
  {
    id: 'fees',
    title: '9. Fees, charges and taxes',
    paragraphs: [
      'AfterWorks does not currently deduct a commission from a worker’s earnings: the fee shown on an accepted job card is the amount credited to your wallet. If we introduce or change a worker-side charge, we will say so clearly on the job card and in these Terms before it applies to any work you accept.',
      'Employers or training providers may charge for optional training modules, and mobile-money or banking partners may charge their own fees for receiving a payout. Any charge we control is shown before you pay; charges imposed by a third party are governed by that provider’s terms.',
      'You are responsible for any income tax, social-security contribution or other tax that applies to money you earn through the Platform. We may ask for tax information, issue statements, or withhold amounts where the law requires us to do so. We do not provide tax advice.',
    ],
  },
  {
    id: 'intellectual-property',
    title: '10. Intellectual property and your work product',
    paragraphs: [
      'The Platform, our name, logo, software, copy, training material and design are owned by AfterWorks or its licensors. You receive a limited, revocable, non-transferable licence to use the Platform for your own work as permitted by these Terms. You may not copy, resell or redistribute the Platform or its content.',
      'You keep ownership of the work you create until it is accepted and paid. During review, you grant us a licence to store, reproduce and share your submission with the client and our reviewers for the purpose of checking it.',
      'On payment for a submission, you assign to AfterWorks (or, where the client requires it, to the client) all right, title and interest in that work product, including copyright and database rights, and you grant any licence needed for the client to use, reproduce and adapt it. To the extent permitted by law, you waive moral rights in the work product. You confirm that you have the right to grant this assignment and that the work does not infringe anyone else’s rights.',
      'Client files, data and materials remain the client’s property. You may use them only to complete the task, and you must not retain, publish or reuse them afterwards.',
    ],
  },
  {
    id: 'confidentiality',
    title: '11. Confidentiality and data protection',
    paragraphs: [
      'You may receive confidential information in the course of a task: client data, unpublished content, business information, personal data of third parties, or non-public information about AfterWorks. You must use that information only for the task, keep it secure, and not disclose it to anyone except as required by law.',
      'Do not copy client data into personal accounts, screenshots, public AI tools, or any service the brief does not permit. Delete client material when the task ends or when we ask you to.',
      'We process your personal data as described in our Privacy Notice. You must also comply with applicable data-protection law when handling personal data in a task, including Kenya’s Data Protection Act, 2019 where it applies.',
    ],
  },
  {
    id: 'acceptable-use',
    title: '12. Acceptable use',
    paragraphs: ['You agree not to do any of the following:'],
    bullets: [
      'Use the Platform for anything unlawful, fraudulent, deceptive or harmful, or to harass, threaten or exploit any person.',
      'Create multiple accounts, impersonate another person, use another person’s ID or phone number, or misrepresent your skills or experience.',
      'Access another member’s account, wallet, documents or referral code, or attempt to bypass authentication or verification.',
      'Use bots, scripts, scrapers, automated submissions or other tools to claim work, farm rewards, or overload the Platform, except where a brief expressly permits automation.',
      'Reverse-engineer, probe, scan or interfere with the Platform’s security or availability, or attempt to extract its source code or data.',
      'Circumvent the clearing window, the withdrawal limit, the one-request-at-a-time rule, the referral cap, the quality review, or any other control we operate.',
      'Contact clients outside the Platform, solicit off-platform payment, or share a client’s confidential material.',
      'Submit content that infringes intellectual property, contains malware, or is defamatory, obscene, or otherwise unlawful.',
    ],
  },
  {
    id: 'suspension',
    title: '13. Suspension, closure and appeals',
    paragraphs: [
      'We may suspend or close an account where we reasonably believe these Terms have been breached, where identity verification fails or is revoked, where an account is duplicated or fraudulent, where required by law or a regulator, or where continuing to operate the account would expose another person to harm. We may also restrict particular features while we investigate.',
      'Where it is practical and lawful to do so, we will tell you that a restriction has been applied, which feature is affected, and what you can do to resolve it. Urgent fraud or security cases may be actioned immediately, with an explanation to follow.',
      'If we close an account, we will return any cleared, withdrawable balance to a payout destination in your name, after applying any holds, reversals or valid charges. Pending earnings and promotional credits may be cancelled where the work was not completed or the credit is connected to the breach.',
      'If you disagree with a decision, contact us at the address in section 17 with your account email and the decision reference. We aim to respond within 14 days, and we will review the decision against the evidence. A suspension that turns out to be a mistake is reversed, along with any credit it removed.',
      'You may close your account at any time. Closing it does not cancel a withdrawal already in progress, and we may retain records we are required to keep.',
    ],
    bullets: [
      'Do not create a new account while an account is suspended; that is itself a breach and may result in both accounts being closed.',
      'If you are a victim of account takeover, report it immediately so we can freeze the account and investigate.',
    ],
  },
  {
    id: 'liability',
    title: '14. Disclaimers and limitation of liability',
    paragraphs: [
      'The Platform is provided on an “as is” and “as available” basis. We work to keep it accurate, available and secure, but we do not promise that it will be uninterrupted, error-free, or available during maintenance windows, provider outages or events outside our reasonable control. We do not guarantee any particular job, client, earnings or outcome.',
      'To the maximum extent permitted by law, AfterWorks is not liable for indirect or consequential loss, loss of profit, loss of opportunity, loss of goodwill, or loss of data arising from your use of the Platform. Our total aggregate liability to you in connection with the Platform is limited to the greater of (a) the total amount credited to your wallet for work in the three months before the event giving rise to the claim, or (b) US$100.',
      'Nothing in these Terms limits or excludes liability for fraud, wilful misconduct, death or personal injury caused by negligence, or any liability that cannot lawfully be limited. Nothing in these Terms affects mandatory consumer or worker protections available to you.',
      'We are not responsible for the acts or omissions of third parties, including payment processors, mobile-money operators, banks and cloud hosts, although we choose them with reasonable care and will assist you in raising a problem with them.',
      'You agree to indemnify AfterWorks against third-party claims, losses and reasonable costs arising from your breach of these Terms, your unlawful use of the Platform, the content you submit, or your infringement of another person’s rights.',
    ],
  },
  {
    id: 'changes',
    title: '15. Changes to these Terms',
    paragraphs: [
      'We may update these Terms from time to time. The version number and effective date at the top of this page identify the text that applies, and the version you accepted is recorded against your account.',
      'When a change is material, we will notify you before it takes effect and, where required, ask you to accept the new version before you continue using the Platform. Changes do not apply retroactively to work already completed or payouts already processed. If you do not agree to a change, stop using the Platform and close your account.',
    ],
  },
  {
    id: 'law',
    title: '16. Governing law and disputes',
    paragraphs: [
      'These Terms are governed by the laws of Kenya, without regard to conflict-of-law rules. Subject to any mandatory consumer protection available where you live, the courts of Kenya have exclusive jurisdiction over any dispute arising from these Terms or the Platform.',
      'Before starting a court claim, please contact us at the address in section 17 and allow at least 30 days for us to try to resolve the issue. We will engage in good faith. Nothing in this section prevents you from reporting a breach of law to a regulator, or from seeking urgent relief where delay would cause harm.',
    ],
  },
  {
    id: 'contact',
    title: '17. Contact and complaints',
    paragraphs: [
      `Questions about these Terms, a decision on your account, a payment or a complaint should be sent to ${TERMS_CONTACT}. Include the email address on your account and, where relevant, the job or transaction reference, so we can find the record quickly.`,
      `The Platform is operated by ${TERMS_ENTITY}. We aim to acknowledge complaints within 14 days. If you are not satisfied with our response, you may ask for the complaint to be escalated, and you retain any right you have to complain to a regulator or court.`,
      'For questions about how we handle personal data, see our Privacy Notice or write to the same address with “Data Protection” in the subject line.',
    ],
  },
] as const

export const PRIVACY_SECTIONS: readonly TermsSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are and what this notice covers',
    paragraphs: [
      `${TERMS_ENTITY} ("AfterWorks", "we", "us") is the controller of the personal data described in this notice. This notice explains what we collect when you use afterworks.site and the worker workspace, why we collect it, who we share it with, how long we keep it and what you can ask us to do about it.`,
      'It applies to workers, applicants and visitors. It does not apply to a client’s own website or to third-party services you reach through a link; those services have their own privacy notices.',
      'Where we act as a processor for a client (for example, when handling data inside a task), the client’s instructions govern that data and we handle it only to deliver the service.',
    ],
  },
  {
    id: 'what-we-collect',
    title: 'What we collect',
    paragraphs: [
      'We collect only what the Platform needs to run your account, verify who you are, pay you correctly and keep the service safe:',
    ],
    bullets: [
      'Account data: your name, email address, mobile phone number, country and the phone number you use for payouts. Your password is handled by our authentication provider in hashed form; we do not see it in plain text.',
      'Profile and eligibility data: your location, professional summary, skills, languages, education and work history, and your payout-method preference.',
      'Identity-verification outcome: whether verification was approved, declined, placed on hold or requires another look, the date it was decided, and any reason supplied for a decision. We keep the outcome rather than the document itself.',
      'Work data: the jobs you view or apply for, your submissions and revisions, quality-review notes, your quality score, deadlines and in-app notifications.',
      'Wallet and payment data: your balances, ledger entries, withdrawal requests, payout destination, transaction references, and training-payment records. Card details for training payments are handled by our payment processor; we do not store your full card number.',
      'Referral data: your referral code, the accounts that signed up with it, whether a referral qualified, and any bonus credited or reversed.',
      'Security and technical data, which may include sign-in events, IP address, browser and device information, session identifiers, rate-limit counters and audit logs of actions taken on your account or by staff.',
      'Communications: messages you send to support, reports you submit, and records of how a complaint or appeal was resolved.',
      'Local storage: interface preferences such as dismissed prompts or tabs you have opened, stored in your browser rather than on our servers.',
    ],
  },
  {
    id: 'how-we-use',
    title: 'How we use your data',
    paragraphs: [
      'We use personal data to create and secure your account, verify your identity, match you with work, run training and assessments, receive and review submissions, calculate balances, process withdrawals, administer referrals, answer support requests and investigate complaints.',
      'We also use it to prevent fraud, duplicate accounts, referral abuse and payment abuse; to enforce our Terms; to keep audit records; to meet tax, anti-money-laundering and other legal obligations; to maintain and improve the Platform; and to send you service messages about your account, work or payments.',
      'We do not sell your personal data, and we do not use your work history or identity data to build advertising profiles. We do not send marketing email unless you have asked to receive it, and you can withdraw that consent at any time.',
    ],
  },
  {
    id: 'legal-bases',
    title: 'Why we are allowed to use it',
    paragraphs: [
      'Where the Kenya Data Protection Act, 2019 applies, we rely on the following bases: performance of our contract with you (running your account, work and payouts); compliance with a legal obligation (identity checks, tax, anti-money-laundering, responding to lawful requests); our legitimate interests (security, fraud prevention, quality review, service improvement and defending legal claims); and your consent where we ask for it (for example, optional communications).',
      'Where the EU or UK General Data Protection Regulation applies, the same categories apply as performance of a contract, legal obligation, legitimate interests and consent. You can object to processing based on legitimate interests, and we will stop unless we have overriding grounds or a legal requirement.',
    ],
  },
  {
    id: 'sharing',
    title: 'Who we share it with',
    paragraphs: [
      'We share the minimum necessary with providers that operate the Platform for us, under contracts that require them to protect it and use it only for the service they provide:',
    ],
    bullets: [
      'Google Firebase — authentication and the Firestore database, running on Google Cloud infrastructure.',
      'Render — hosts the application and keeps short-lived access logs used for security and troubleshooting.',
      'Our own staff — when you ask for identity verification, a member of our review team reads the profile and any document you provide and records the decision. We do not send your identity documents to a third-party verification provider.',
      'Paystack — processes training-module payments and returns the transaction reference and status. Card details are handled by Paystack, not stored by us.',
      'Resend — delivers transactional email such as verification links and account notices.',
      'Mobile-money and banking partners — receive your name, payout destination and the amount when a withdrawal is processed.',
      'Professional advisers, auditors and insurers — where necessary and bound by confidentiality.',
      'Authorities, courts and regulators — where we are legally required to disclose, or where disclosure is necessary to establish, exercise or defend a legal claim.',
      'A successor entity — if AfterWorks is merged, acquired or transfers its assets, subject to this notice continuing to apply to the transferred data.',
    ],
  },
  {
    id: 'transfers',
    title: 'International transfers',
    paragraphs: [
      'Some of our providers process data outside Kenya, including in the European Union, the United States and other countries in which they operate. Where data is transferred across borders, we use appropriate safeguards: contractual data-protection terms with the provider, transfer mechanisms recognised by the applicable law, access controls and encryption in transit. You can ask us for more information about the safeguards used for a particular provider.',
    ],
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    paragraphs: [
      'We keep account and profile data while your account is open. Financial records — earnings, withdrawals, payment references and related ledger entries — are generally kept for five years after the relevant transaction, or longer where tax, anti-money-laundering or accounting law requires it.',
      'Identity-verification outcomes and references are kept for as long as the law requires us to be able to demonstrate that a check was performed. Security and audit logs are kept for a limited operational period, then deleted or aggregated. Support records are kept while needed to resolve the issue and to defend legal claims.',
      'When data is no longer needed, we delete it or anonymise it. If you ask us to delete your account, we will remove data we are not required to keep and tell you what remains and why.',
    ],
  },
  {
    id: 'security',
    title: 'How we protect it',
    paragraphs: [
      'We use encryption in transit, access controls and least-privilege permissions, rate limiting, audit logging, backups and separation between member and operations access. Staff can see account data only where their role requires it, and administrative actions are logged.',
      'No online service is completely secure. If we become aware of a personal-data breach that is likely to result in a risk to your rights, we will notify the relevant regulator and affected people as required by law. Keep your password private, use a unique password, and tell us at once if you suspect account takeover.',
    ],
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    paragraphs: [
      'Subject to applicable law, you can ask us for a copy of the personal data we hold about you, ask us to correct inaccurate data, ask us to delete it, ask us to restrict or stop certain processing, object to processing based on legitimate interests, and receive data you provided in a portable format. Where processing is based on consent, you can withdraw it at any time.',
      'To make a request, email us at the address below from the address on your account, or contact support and we will verify your identity before acting. We respond within 30 days; if we need longer because a request is complex, we will tell you why and when to expect a response.',
      'These rights are not absolute. We may keep data where the law requires it, where it is needed to resolve a dispute, or where it belongs to someone else. If we refuse a request, we will explain the reason.',
      'You can also complain to the Office of the Data Protection Commissioner in Kenya. If you are in the EU or UK, you may complain to your local supervisory authority.',
    ],
  },
  {
    id: 'automated-decisions',
    title: 'Automated checks and human review',
    paragraphs: [
      'Identity verification and some quality checks use automated tools to detect mismatches, duplicate identities and patterns of abuse. Some of those checks can produce an immediate outcome, including a declined verification. You can ask for a human review of any decision that significantly affects you: we will look at the evidence, explain the outcome and correct the decision if it was mistaken.',
      'If an automated check leads to a decision you think is wrong, contact support and ask for a human review. We will look at the evidence, explain the outcome and correct the decision if it was mistaken.',
    ],
  },
  {
    id: 'cookies',
    title: 'Cookies and local storage',
    paragraphs: [
      'Our authentication provider stores your sign-in token in your browser’s local storage so you stay signed in, and we set a short-lived browser-session marker cookie that lets the app notice when a browser session ends. Staff sessions use an additional signed, HttpOnly cookie for the operations console and maintenance access. We also store small interface preferences in local storage so prompts you dismissed do not reappear.',
      'We do not use advertising cookies, cross-site tracking cookies or third-party marketing pixels. If we add non-essential cookies in future, we will ask for consent where the law requires it. You can clear cookies and local storage in your browser, but blocking the session cookie will sign you out and may stop the Platform working.',
    ],
  },
  {
    id: 'children',
    title: 'Children',
    paragraphs: [
      'The Platform is for people aged 18 and over. We do not knowingly collect personal data from a child under 18. If we learn that an account belongs to someone under 18, we will close it and delete the data we are not required to keep. If you believe a child has created an account, contact us so we can investigate.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to this notice',
    paragraphs: [
      'We may update this notice when the Platform, our providers or the law change. The version number and effective date at the top of this page identify the current text. Where a change is material, we will notify you and, where required, ask you to accept the updated Terms and Privacy Notice before continuing.',
    ],
  },
  {
    id: 'contact',
    title: 'Contact us',
    paragraphs: [
      `For privacy questions, data-subject requests or a complaint about how we handle your data, email ${TERMS_CONTACT} with “Data Protection” in the subject line. Include the email address on your account so we can locate the right record.`,
      `The controller is ${TERMS_ENTITY}. We aim to respond to privacy requests within 30 days. If you are not satisfied, you may complain to the Office of the Data Protection Commissioner in Kenya or, where applicable, your local supervisory authority.`,
    ],
  },
] as const

/** Deep link to one section, used by the sign-up checkboxes and the referral panel. */
export function termsHref(sectionId?: string): string {
  return sectionId ? `/terms#${sectionId}` : '/terms'
}

export function privacyHref(sectionId?: string): string {
  return sectionId ? `/privacy#${sectionId}` : '/privacy'
}
