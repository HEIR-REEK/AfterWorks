// Minimal in-repo data + helpers used by the demo app.

export type JobCategory =
  | 'Data Entry'
  | 'Transcription'
  | 'Image Labeling'
  | 'Content Review'
  | 'Translation'
  | 'Research'

export type JobStatus = 'open' | 'paused' | 'closed'

/** One authored training section. Workers step through these one at a time on the training page. */
export type TrainingSection = {
  title: string
  content: string
}

/** One authored assessment question. Options are 2–4 strings; `correctIndex` points at the right one. */
export type AssessmentQuestion = {
  question: string
  options: string[]
  correctIndex: number
}

/** Canonical category list — client forms and the server validator both read this. */
export const JOB_CATEGORY_LIST: readonly JobCategory[] = [
  'Data Entry',
  'Transcription',
  'Image Labeling',
  'Content Review',
  'Translation',
  'Research',
]

export type Job = {
  id: string
  title: string
  category: JobCategory
  description: string
  responsibilities: string[]
  payAmountUsd: number
  estimatedMinutes: number
  capacity: number
  slotsRemaining: number
  trainingRequired: boolean
  /**
   * Per-job training price in USD, decided by the admin when publishing the card. Only meaningful
   * when `trainingRequired` is true; falls back to the globally configured fee when absent.
   */
  trainingFeeUsd?: number
  /** Admin-authored training sections. Empty/absent → the built-in category modules are used. */
  trainingNotes?: TrainingSection[]
  /** Admin-authored assessment questions. Empty/absent → the built-in category bank is used. */
  assessmentQuestions?: AssessmentQuestion[]
  requiresVerified: boolean
  status: JobStatus
  // ISO date string for the closing condition
  closesAt: string
  postedAgo: string
}

// The full application lifecycle from the spec:
// submitted -> under_review -> approved | rejected
//   (if approved) -> in_progress -> submitted_for_review
//     -> completed | revision_requested | failed_qa
export type ApplicationStatus =
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'in_progress'
  | 'submitted_for_review'
  | 'revision_requested'
  | 'completed'
  | 'failed_qa'

export type Application = {
  id: string
  jobId: string
  status: ApplicationStatus
  appliedAt: string // ISO
  // When under_review, applications auto-expire after this window (48h in spec).
  reviewExpiresAt: string // ISO
  rejectionReason?: string
  revisionNote?: string
  history: { status: ApplicationStatus; at: string }[]
}

/**
 * All possible values for a user's accountState.
 * Mirrors AccountState from lib/firestore.ts — kept in sync manually.
 */
export type AccountState =
  | 'active'
  | 'kyc_rejected'
  | 'kyc_resubmission'
  | 'kyc_on_hold'
  | 'kyc_abandoned'
  | 'kyc_expired'
  | 'suspended'
  | 'banned'

export type WorkerProfile = {
  name: string
  email: string
  location: string
  accountState: AccountState
  role?: 'admin' | 'user'
  isAdmin?: boolean
  kycVerified: boolean
  qualityScore: number // 0-100
  jobsCompleted: number
  memberSince: string
  phone?: string
  bio?: string
  skills?: string[]
  languages?: string[]
  preferredPayoutMethod?: string
  country?: string
  zipCode?: string
  bankName?: string
  bankBranch?: string
  bankAccountNumber?: string
  school?: string
  course?: string
  jobExperience?: string
  career?: string
  kycVerifiedAt?: string
  kycRejectedAt?: string
  kycOnHoldAt?: string
  kycProvider?: string
  kycLevel?: string
  kycStatus?: string
  /** Human-readable reason if KYC was declined or flagged. */
  kycRejectionReason?: string | null
  /** Names of sub-checks that failed, e.g. ['liveness', 'document']. */
  kycFailedChecks?: string[] | null
}

export type Wallet = {
  pendingUsd: number
  availableUsd: number
  payoutNumber: string
}

// Approx display rate; spec says KES shown at payment-time rate.
export const USD_TO_KES = 129

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function getExchangeRateUsdToKes(): number {
  const envRate =
    (typeof process !== 'undefined' &&
      (process.env.NEXT_PUBLIC_USD_TO_KES_RATE || process.env.USD_TO_KES_RATE)) ||
    ''
  if (envRate) {
    const num = Number(envRate)
    if (!isNaN(num) && num > 0) return num
  }
  return USD_TO_KES
}

/**
 * Dynamic helper to get configured Paystack training fee in USD dollars.
 * Configurable via NEXT_PUBLIC_PAYSTACK_TRAINING_AMOUNT or PAYSTACK_TRAINING_AMOUNT.
 * Default fallback: 10 ($10 USD).
 */
export function getTrainingFeeUsd(overrideAmount?: number | string | null): number {
  if (overrideAmount !== undefined && overrideAmount !== null && overrideAmount !== '') {
    const num = Number(overrideAmount)
    if (!isNaN(num) && num > 0) {
      return num >= 100 ? num / 100 : num
    }
  }

  const envVal =
    (typeof process !== 'undefined' &&
      (process.env.NEXT_PUBLIC_PAYSTACK_TRAINING_AMOUNT ||
        process.env.PAYSTACK_TRAINING_AMOUNT)) ||
    ''

  if (envVal) {
    const num = Number(envVal)
    if (!isNaN(num) && num > 0) {
      return num >= 100 ? num / 100 : num
    }
  }
  return 10
}

/**
 * Returns the exact KES amount to be charged by Paystack for training.
 * Configurable directly via PAYSTACK_AMOUNT_KES or NEXT_PUBLIC_PAYSTACK_AMOUNT_KES.
 * Defaults to: (Training Fee USD) * (USD to KES Exchange Rate).
 */
export function getTrainingFeeKes(overrideUsd?: number): number {
  const envKes =
    (typeof process !== 'undefined' &&
      (process.env.NEXT_PUBLIC_PAYSTACK_AMOUNT_KES || process.env.PAYSTACK_AMOUNT_KES)) ||
    ''
  if (envKes && !overrideUsd) {
    const num = Number(envKes)
    if (!isNaN(num) && num > 0) return num
  }
  const usd = getTrainingFeeUsd(overrideUsd)
  return Math.round(usd * getExchangeRateUsdToKes())
}

/**
 * Returns the amount in Paystack's required subunit for KES (cents, i.e. KES * 100).
 */
export function getPaystackAmountSubunits(overrideUsd?: number): number {
  return getTrainingFeeKes(overrideUsd) * 100
}

export function getTrainingFeeCents(overrideAmount?: number | string | null): number {
  return Math.round(getTrainingFeeUsd(overrideAmount) * 100)
}

/**
 * The USD price of training for one job card. Admins set this per job; when the job carries no
 * fee of its own (older documents, seeded demo cards) the globally configured fee applies.
 * Unlike `getTrainingFeeUsd`, a per-job fee is taken at face value — no cents heuristic.
 */
export function trainingFeeUsdFor(jobFeeUsd?: number | string | null): number {
  const num = Number(jobFeeUsd)
  if (Number.isFinite(num) && num > 0) return Math.round(num * 100) / 100
  return getTrainingFeeUsd()
}

/** KES checkout price for one job card's training: the per-job fee first, global config as fallback. */
export function trainingFeeKesFor(jobFeeUsd?: number | string | null): number {
  const num = Number(jobFeeUsd)
  if (Number.isFinite(num) && num > 0) {
    return Math.round((Math.round(num * 100) / 100) * getExchangeRateUsdToKes())
  }
  return getTrainingFeeKes()
}

/** Paystack subunits (KES cents) for one job card's training fee. */
export function paystackSubunitsFor(jobFeeUsd?: number | string | null): number {
  return trainingFeeKesFor(jobFeeUsd) * 100
}

/**
 * Pass mark for an assessment of any length. Keeps the original 10-of-15 ratio (⅔, rounded up),
 * so a custom bank of 6 questions needs 4, and the built-in 15-question banks still need 10.
 */
export function assessmentPassMark(questionCount: number): number {
  const n = Math.max(1, Math.floor(questionCount) || 1)
  return Math.max(1, Math.ceil((n * 2) / 3))
}

export function formatKes(usd: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(usd * USD_TO_KES)
}

/** Format an amount that is already denominated in Kenyan Shillings (no FX conversion). */
export function formatKesValue(kes: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(kes)
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} hr${hours === 1 ? '' : 's'}`
}

function daysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export function seedJobs(): Job[] {
  return [
    // ── Transcription ────────────────────────────────────────────────────────
    {
      id: 'job-audio-sw',
      title: 'Transcribe Swahili customer support calls',
      category: 'Transcription',
      description:
        'Listen to short recorded customer support calls (2–4 min each) and type accurate Swahili transcripts. Clear audio, familiar everyday vocabulary.',
      responsibilities: [
        'Transcribe 20 short audio clips verbatim',
        'Add speaker labels (Agent / Customer)',
        'Flag any inaudible sections with a timestamp',
      ],
      payAmountUsd: 18,
      estimatedMinutes: 150,
      capacity: 80,
      slotsRemaining: 64,
      trainingRequired: false,
      trainingNotes: [
        {
          title: 'How these support calls are structured',
          content:
            'Each clip is a two-party call: an agent and a customer. Expect greetings, a problem description, and a resolution. Label every paragraph with the speaker (Agent: / Customer:) so the transcript stays readable.',
        },
        {
          title: 'Swahili shorthand to watch for',
          content:
            'Callers often mix Swahili and English mid-sentence. Transcribe exactly what is spoken in each language — do not translate the English parts into Swahili or vice versa. Use standard Swahili orthography for numbers and greetings.',
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(3),
      postedAgo: '2 hours ago',
    },
    {
      id: 'job-medical-transcription',
      title: 'Transcribe medical consultation recordings',
      category: 'Transcription',
      description:
        'Convert recorded doctor-patient consultations into clean text. Requires attention to medical terminology — a glossary is provided. High accuracy is critical.',
      responsibilities: [
        'Transcribe 15 consultation recordings (3–6 min each)',
        'Use the provided medical glossary for terminology',
        'Mark unclear speech with [inaudible] tags',
        'Maintain patient confidentiality at all times',
      ],
      payAmountUsd: 55,
      estimatedMinutes: 300,
      capacity: 40,
      slotsRemaining: 32,
      trainingRequired: true,
      trainingFeeUsd: 15,
      trainingNotes: [
        {
          title: 'Section 1: The medical transcription workflow',
          content:
            'You will receive a recording of a doctor-patient consultation plus the matching glossary. Play the recording once all the way through before typing anything — this gives you the full context of the case.\n\nThen work in short passes: type what you hear, mark anything unclear with [inaudible] plus the timestamp, and only consult the glossary after the first pass so your flow is not interrupted.',
        },
        {
          title: 'Section 2: Using the medical glossary correctly',
          content:
            'Medical terms must match the glossary spelling exactly — "oedema" and "edema" are not interchangeable in this project, and drug names are case-sensitive.\n\nIf a term is spoken but not in the glossary, transcribe it phonetically inside [phonetic] brackets and flag the segment for review. Never guess a drug name: a wrong medication name is an automatic rejection.',
        },
        {
          title: 'Section 3: Confidentiality & submission checklist',
          content:
            'Consultations contain personal health information. Never copy excerpts outside the platform, never discuss cases anywhere else, and delete nothing you were given.\n\nBefore submitting, run the checklist:\n- Every [inaudible] has a timestamp\n- All drug names match the glossary exactly\n- Speaker labels (Doctor / Patient) are on every paragraph\n- The transcript is proofread once, top to bottom',
        },
      ],
      assessmentQuestions: [
        {
          question: 'You cannot make out a medication name in the recording. What do you do?',
          options: [
            'Guess the most likely drug from the context of the consultation.',
            'Transcribe it phonetically inside [phonetic] brackets and flag the segment for review.',
            'Leave the word out of the transcript entirely.',
            'Use a similar drug name from the glossary.',
          ],
          correctIndex: 1,
        },
        {
          question: 'The glossary spells a condition "oedema". The doctor says it clearly. How do you type it?',
          options: [
            'Exactly as the glossary spells it: oedema.',
            'However you normally spell it — both forms are accepted.',
            'In capitals to highlight the term.',
            'With a [sic] tag after it.',
          ],
          correctIndex: 0,
        },
        {
          question: 'Which item is NOT part of the submission checklist?',
          options: [
            'Every [inaudible] tag has a timestamp.',
            'Speaker labels appear on every paragraph.',
            'A short summary of the diagnosis is added at the top.',
            'The transcript has been proofread once from top to bottom.',
          ],
          correctIndex: 2,
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(7),
      postedAgo: '3 hours ago',
    },
    {
      id: 'job-podcast-transcription',
      title: 'Transcribe English podcast episodes',
      category: 'Transcription',
      description:
        'Convert podcast episodes to clean, readable text. Episodes average 20 minutes. You will receive timestamps and speaker-change markers.',
      responsibilities: [
        'Transcribe 5 podcast episodes verbatim',
        'Add timestamp every 2 minutes',
        'Label speakers by letter (Speaker A, Speaker B)',
      ],
      payAmountUsd: 22,
      estimatedMinutes: 180,
      capacity: 60,
      slotsRemaining: 47,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(5),
      postedAgo: '1 day ago',
    },
    {
      id: 'job-legal-transcription',
      title: 'Transcribe court proceeding recordings',
      category: 'Transcription',
      description:
        'Transcribe audio from court hearings and depositions with high accuracy. Legal terminology glossary provided. Strict formatting guidelines apply.',
      responsibilities: [
        'Transcribe 10 legal audio clips (5–10 min each)',
        'Format according to the legal transcript template',
        'Use provided glossary for legal terms',
        'Flag any unclear segments with timestamps',
      ],
      payAmountUsd: 70,
      estimatedMinutes: 360,
      capacity: 25,
      slotsRemaining: 20,
      trainingRequired: true,
      trainingFeeUsd: 20,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(8),
      postedAgo: '4 hours ago',
    },

    // ── Image Labeling ───────────────────────────────────────────────────────
    {
      id: 'job-image-label',
      title: 'Label street scene images for a mapping dataset',
      category: 'Image Labeling',
      description:
        'Draw bounding boxes around vehicles, pedestrians, and road signs in street-level photos. Full guidelines provided; consistency matters more than speed.',
      responsibilities: [
        'Label 100 images using the provided tool',
        'Follow the category guide exactly',
        'Skip and report any corrupted images',
      ],
      payAmountUsd: 48,
      estimatedMinutes: 240,
      capacity: 100,
      slotsRemaining: 78,
      trainingRequired: true,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(6),
      postedAgo: '1 day ago',
    },
    {
      id: 'job-xray-label',
      title: 'Annotate chest X-ray regions for AI training',
      category: 'Image Labeling',
      description:
        'Identify and mark anatomical regions in chest X-ray images using a guided annotation tool. Training module covers all required regions. High-value medical AI dataset.',
      responsibilities: [
        'Annotate 80 X-ray images using the provided tool',
        'Mark lung fields, heart silhouette, and diaphragm',
        'Flag any ambiguous images for radiologist review',
        'Maintain consistent annotation style throughout',
      ],
      payAmountUsd: 75,
      estimatedMinutes: 420,
      capacity: 30,
      slotsRemaining: 24,
      trainingRequired: true,
      trainingFeeUsd: 25,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(10),
      postedAgo: '2 days ago',
    },
    {
      id: 'job-food-label',
      title: 'Classify food images by category',
      category: 'Image Labeling',
      description:
        'Look at food photos and assign each one to the correct food category (e.g. beverages, grains, proteins). Simple, fun task — no special knowledge required.',
      responsibilities: [
        'Classify 200 food images from a provided list',
        'Choose the single best-fitting category per image',
        'Flag any non-food or unclear images',
      ],
      payAmountUsd: 12,
      estimatedMinutes: 90,
      capacity: 150,
      slotsRemaining: 121,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(4),
      postedAgo: '6 hours ago',
    },
    {
      id: 'job-satellite-label',
      title: 'Identify land-use types in satellite imagery',
      category: 'Image Labeling',
      description:
        'View satellite images and classify each tile as farmland, urban, forest, water, or barren. Detailed training module with examples for each class.',
      responsibilities: [
        'Classify 150 satellite image tiles',
        'Choose the dominant land-use type per tile',
        'Use provided legend for reference',
        'Complete the accuracy quiz before starting',
      ],
      payAmountUsd: 60,
      estimatedMinutes: 300,
      capacity: 50,
      slotsRemaining: 41,
      trainingRequired: true,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(9),
      postedAgo: '5 hours ago',
    },

    // ── Data Entry ──────────────────────────────────────────────────────────
    {
      id: 'job-data-entry',
      title: 'Digitize handwritten survey forms',
      category: 'Data Entry',
      description:
        'Enter responses from scanned handwritten survey forms into a structured spreadsheet. Attention to detail required for numeric fields.',
      responsibilities: [
        'Enter 50 survey forms into the template',
        'Double-check all phone and ID number fields',
        'Mark unreadable entries as "unclear"',
      ],
      payAmountUsd: 14,
      estimatedMinutes: 120,
      capacity: 120,
      slotsRemaining: 95,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(2),
      postedAgo: '5 hours ago',
    },
    {
      id: 'job-receipt-entry',
      title: 'Extract receipt data into a spreadsheet',
      category: 'Data Entry',
      description:
        'You will receive scanned receipt images. Extract the merchant name, date, itemised totals, and grand total into a provided spreadsheet template.',
      responsibilities: [
        'Process 80 receipt scans',
        'Extract 5 data fields per receipt accurately',
        'Convert all amounts to KES where currency differs',
      ],
      payAmountUsd: 16,
      estimatedMinutes: 140,
      capacity: 90,
      slotsRemaining: 73,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(3),
      postedAgo: '7 hours ago',
    },
    {
      id: 'job-property-data',
      title: 'Enter property listing details from PDF brochures',
      category: 'Data Entry',
      description:
        'Extract structured data from real-estate PDF brochures into a database template. Fields include price, location, bedroom count, amenities, and agent contact.',
      responsibilities: [
        'Process 60 property brochures',
        'Enter all required fields per the schema',
        'Standardize address formats to the provided convention',
      ],
      payAmountUsd: 20,
      estimatedMinutes: 160,
      capacity: 70,
      slotsRemaining: 58,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(4),
      postedAgo: '1 day ago',
    },

    // ── Content Review ───────────────────────────────────────────────────────
    {
      id: 'job-content-review',
      title: 'Review marketplace listings for policy violations',
      category: 'Content Review',
      description:
        'Read short product listings and flag any that break the provided content policy (prohibited items, misleading claims). Sensitive-content safe.',
      responsibilities: [
        'Review 200 listings against the policy checklist',
        'Select a violation reason for each flagged item',
        'Escalate ambiguous cases instead of guessing',
      ],
      payAmountUsd: 45,
      estimatedMinutes: 180,
      capacity: 60,
      slotsRemaining: 47,
      trainingRequired: true,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(4),
      postedAgo: '3 days ago',
    },
    {
      id: 'job-social-review',
      title: 'Moderate social media comments for a news platform',
      category: 'Content Review',
      description:
        'Review user-submitted comments on a news website and categorize them as: safe, spam, hate speech, or misinformation. Policy guide provided.',
      responsibilities: [
        'Review 300 user comments',
        'Assign one of four categories per comment',
        'Submit confidence score (high / medium / low)',
        'Escalate borderline cases',
      ],
      payAmountUsd: 65,
      estimatedMinutes: 300,
      capacity: 35,
      slotsRemaining: 28,
      trainingRequired: true,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(6),
      postedAgo: '8 hours ago',
    },
    {
      id: 'job-ad-review',
      title: 'Review ad creatives for brand safety',
      category: 'Content Review',
      description:
        'Evaluate advertising images and text to ensure they meet brand-safety standards for a digital ad network. Look for violent, adult, or controversial content.',
      responsibilities: [
        'Review 150 ad creatives (image + text)',
        'Flag any that violate the brand-safety guidelines',
        'Rate each ad: safe / restricted / rejected',
      ],
      payAmountUsd: 28,
      estimatedMinutes: 200,
      capacity: 55,
      slotsRemaining: 43,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(5),
      postedAgo: '2 days ago',
    },

    // ── Translation ──────────────────────────────────────────────────────────
    {
      id: 'job-translation',
      title: 'Translate short product descriptions EN → Swahili',
      category: 'Translation',
      description:
        'Translate 40 short e-commerce product descriptions from English to natural, everyday Swahili. Tone should be friendly and clear.',
      responsibilities: [
        'Translate all 40 descriptions',
        'Keep product names and units unchanged',
        'Maintain a consistent, friendly tone',
      ],
      payAmountUsd: 30,
      estimatedMinutes: 200,
      capacity: 80,
      slotsRemaining: 62,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(5),
      postedAgo: '6 hours ago',
    },
    {
      id: 'job-legal-translation',
      title: 'Translate legal contracts EN → Swahili',
      category: 'Translation',
      description:
        'Translate standard commercial contracts from English into Swahili. Legal terminology glossary and reference translations provided. High accuracy is mandatory.',
      responsibilities: [
        'Translate 5 contract documents (2–4 pages each)',
        'Use the provided legal glossary for technical terms',
        'Preserve numbering, headings and formatting',
        'Flag any ambiguous clauses for review',
      ],
      payAmountUsd: 80,
      estimatedMinutes: 480,
      capacity: 20,
      slotsRemaining: 16,
      trainingRequired: true,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(10),
      postedAgo: '1 day ago',
    },
    {
      id: 'job-ui-translation',
      title: 'Translate mobile app UI strings EN → Kikuyu',
      category: 'Translation',
      description:
        'Translate a set of mobile app interface strings from English into Kikuyu. Short phrases — keep them concise to fit UI buttons and labels.',
      responsibilities: [
        'Translate 250 UI strings from the provided CSV',
        'Keep translations under the character limit per field',
        'Maintain consistent terminology with the glossary',
      ],
      payAmountUsd: 35,
      estimatedMinutes: 240,
      capacity: 45,
      slotsRemaining: 37,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(6),
      postedAgo: '3 hours ago',
    },

    // ── Research ─────────────────────────────────────────────────────────────
    {
      id: 'job-research',
      title: 'Verify business contact details from public sources',
      category: 'Research',
      description:
        'Given a list of business names, find and verify their current phone number and physical address using public web sources. No paid tools needed.',
      responsibilities: [
        'Verify details for 60 businesses',
        'Record the source URL for each entry',
        'Mark businesses you cannot verify',
      ],
      payAmountUsd: 20,
      estimatedMinutes: 210,
      capacity: 75,
      slotsRemaining: 0,
      trainingRequired: false,
      requiresVerified: true,
      status: 'closed',
      closesAt: daysFromNow(-1),
      postedAgo: '1 week ago',
    },
    {
      id: 'job-competitor-research',
      title: 'Compile competitor pricing data from e-commerce sites',
      category: 'Research',
      description:
        'Visit public e-commerce websites and record prices for a set list of products across five competitor stores. Straightforward — no logins or payments required.',
      responsibilities: [
        'Visit 5 e-commerce sites and log 30 product prices each',
        'Enter data into the provided Google Sheet',
        'Flag any out-of-stock items separately',
      ],
      payAmountUsd: 24,
      estimatedMinutes: 180,
      capacity: 65,
      slotsRemaining: 52,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(4),
      postedAgo: '9 hours ago',
    },
    {
      id: 'job-sentiment-research',
      title: 'Rate customer reviews for sentiment and topic',
      category: 'Research',
      description:
        'Read customer reviews for various products and rate them for sentiment (positive / neutral / negative) and tag the main topic discussed. Training covers edge cases.',
      responsibilities: [
        'Rate 250 customer reviews for sentiment',
        'Assign one topic tag per review from the provided list',
        'Flag reviews with mixed sentiment for spot-check',
      ],
      payAmountUsd: 50,
      estimatedMinutes: 270,
      capacity: 55,
      slotsRemaining: 44,
      trainingRequired: true,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(7),
      postedAgo: '5 hours ago',
    },

    // ── Additional high-value training jobs ──────────────────────────────────
    {
      id: 'job-finance-data-review',
      title: 'Validate financial statements for AI training dataset',
      category: 'Data Entry',
      description:
        'Review digitised financial statements and confirm that all figures are correctly extracted. Requires attention to detail and basic numeracy. Comprehensive training included.',
      responsibilities: [
        'Validate 100 financial statement extractions',
        'Cross-check totals and line-item figures',
        'Flag discrepancies with a reason code',
        'Complete accuracy must be above 95%',
      ],
      payAmountUsd: 65,
      estimatedMinutes: 360,
      capacity: 30,
      slotsRemaining: 24,
      trainingRequired: true,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(8),
      postedAgo: '12 hours ago',
    },
    {
      id: 'job-audio-en-dialect',
      title: 'Transcribe English spoken in East African dialects',
      category: 'Transcription',
      description:
        'Transcribe audio clips of English spoken with East African accent variations. Familiarity with Kenyan, Ugandan, or Tanzanian English accents is a strong advantage.',
      responsibilities: [
        'Transcribe 30 audio clips (2–3 min each)',
        'Mark any dialect-specific expressions in brackets',
        'Use standard written English for the transcript',
      ],
      payAmountUsd: 26,
      estimatedMinutes: 220,
      capacity: 70,
      slotsRemaining: 58,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(5),
      postedAgo: '4 hours ago',
    },
    {
      id: 'job-drone-image-label',
      title: 'Annotate drone footage for agricultural AI',
      category: 'Image Labeling',
      description:
        'Label crop types and field boundaries in drone images of farmland. Detailed training module included — no prior agricultural knowledge needed.',
      responsibilities: [
        'Annotate 120 drone image frames',
        'Draw field boundary polygons accurately',
        'Tag crop type using the provided legend',
        'Pass the calibration test before full task begins',
      ],
      payAmountUsd: 58,
      estimatedMinutes: 330,
      capacity: 40,
      slotsRemaining: 33,
      trainingRequired: true,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(9),
      postedAgo: '2 days ago',
    },
  ]
}

export function seedWorker(): WorkerProfile {
  return {
    name: '',
    email: '',
    location: '',
    accountState: 'active',
    kycVerified: false,
    qualityScore: 100,
    jobsCompleted: 0,
    memberSince: '',
    phone: '',
    bio: '',
    skills: [],
    languages: [],
    preferredPayoutMethod: 'M-Pesa',
  }
}

export function seedWallet(): Wallet {
  return {
    pendingUsd: 0,
    availableUsd: 0,
    payoutNumber: '',
  }
}

export function seedApplications(): Application[] {
  return []
}

// --- Application lifecycle helpers ---

export const APPLICATION_LABELS: Record<ApplicationStatus, string> = {
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  in_progress: 'In progress',
  submitted_for_review: 'Submitted for QA',
  revision_requested: 'Revision requested',
  completed: 'Completed & paid',
  failed_qa: 'Failed QA',
}

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export const APPLICATION_TONE: Record<ApplicationStatus, StatusTone> = {
  under_review: 'info',
  approved: 'info',
  rejected: 'danger',
  in_progress: 'info',
  submitted_for_review: 'warning',
  revision_requested: 'warning',
  completed: 'success',
  failed_qa: 'danger',
}
