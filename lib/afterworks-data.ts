// Minimal in-repo data + helpers used by the demo app.

export type JobCategory =
  | 'Data Entry'
  | 'Transcription'
  | 'Image Labeling'
  | 'Content Review'
  | 'Translation'
  | 'Research'

export type JobStatus = 'open' | 'paused' | 'closed'

/**
 * The pedagogical role of a lesson. Built-in courses are structured like a short academy
 * coursebook: concepts explain a rule, scenarios ask the learner to apply it, labs produce a
 * deliverable, and checkpoints prove readiness before the assessment.
 */
export type TrainingLessonKind = 'concept' | 'scenario' | 'lab' | 'checkpoint'

export const TRAINING_LESSON_KINDS: readonly TrainingLessonKind[] = [
  'concept',
  'scenario',
  'lab',
  'checkpoint',
]

/** A glossary entry rendered in the course reference section. */
export type TrainingKeyTerm = {
  term: string
  definition: string
}

/**
 * One training lesson. `content` is a small, plain-text markup subset (paragraphs, `-` bullets,
 * `> callouts`, `**bold**`, `` `code` ``) rendered by the training reader. `image` is an optional
 * figure shown beneath the lesson body — a same-origin path such as
 * `/training/transcription-quality.svg` or a plain https URL. Alt text and a caption are authored
 * alongside it.
 */
export type TrainingSection = {
  title: string
  content: string
  /** Chapter the lesson belongs to, e.g. "Unit 2 · Method & standards". */
  unit?: string
  /** Concept, scenario, lab or checkpoint. Drives the badge and course map. */
  kind?: TrainingLessonKind
  /** One sentence explaining what the learner can do after this lesson. */
  objective?: string
  image?: string
  imageAlt?: string
  imageCaption?: string
  /** Estimated reading time, in minutes. Built-in courses use this for the course header. */
  durationMinutes?: number
  /** Optional knowledge check shown at the end of the lesson. */
  check?: TrainingCheck
}

/** A short end-of-lesson knowledge check. It can carry a diagram, like an academy checkpoint. */
export type TrainingCheck = {
  question: string
  options: string[]
  correctIndex: number
  explanation?: string
  image?: string
  imageAlt?: string
}

/**
 * One assessment question. Options are 2–4 strings; `correctIndex` points at the right one.
 * Image fields let a question carry a screenshot/figure, and `explanation` is shown after the
 * worker submits so the assessment teaches rather than only scores.
 */
export type AssessmentQuestion = {
  question: string
  options: string[]
  correctIndex: number
  image?: string
  imageAlt?: string
  explanation?: string
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

/**
 * Only allow a same-origin path or a plain https URL in an authored image field.
 *
 * Training content is stored as data, so a `javascript:`/`data:` value must never end up in an
 * `<img src>`. Returning `undefined` makes the renderer omit the figure entirely instead of
 * showing a broken image.
 */
export function safeImageSrc(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > 500) return undefined
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:') return url.toString()
  } catch {
    return undefined
  }
  return undefined
}

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
  /**
   * Which kind of card this is. `true` → a training card: modules and a training fee. `false` → an
   * assessment-only card: no modules, no fee. The admin sets it when publishing, and it is the one
   * thing the fee hangs on.
   */
  trainingRequired: boolean
  /**
   * Per-job training price in USD, set by the admin. Only meaningful on a training card; falls back
   * to the globally configured fee when absent.
   */
  trainingFeeUsd?: number
  /**
   * Admin-authored training sections — the modules of a training card. Empty/absent is fine: the
   * built-in category coursebook is used instead, so a training card always has modules to work
   * through. Ignored entirely on an assessment-only card.
   */
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
  /** ISO-3166 code the phone number was entered against (drives the flag + dialling code). */
  phoneCountry?: string
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
  /** When the member asked for a manual review, if they have. Server-written; drives the UI state. */
  kycRequestedAt?: string
  /** Human-readable reason if KYC was declined or flagged. */
  kycRejectionReason?: string | null
  /** Legacy: sub-checks the removed provider reported as failed. Nothing writes it now; kept so old records still read. */
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
    // Up to 4 places so sub-dollar training fees (e.g. 0.0077) display as set.
    maximumFractionDigits: 4,
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
 * Whether this is a *training* card or an *assessment-only* card.
 *
 * The board is made of two kinds of card, and the admin says which one a card is:
 *
 *   • a training card has modules and a training fee. The modules are the admin's authored sections
 *     when there are any, and the built-in category coursebook when there are not — so a training
 *     card always has something to work through. The worker pays, then trains, then is assessed.
 *   • an assessment-only card has neither. No modules, no fee: a verified worker goes straight to
 *     the assessment and then applies.
 *
 * This flag *is* that choice, and it is also what the fee hangs on — a training card charges
 * because it is a training card. The two cannot drift apart, because there is only one question
 * being asked.
 */
export function jobHasTraining(job: { trainingRequired?: boolean } | null | undefined): boolean {
  return job?.trainingRequired === true
}

/**
 * Whether a worker must pay a training fee for this card. Same question as `jobHasTraining()`, named
 * for the call sites that are asking about money rather than about content.
 */
export function jobRequiresTrainingFee(job: { trainingRequired?: boolean } | null | undefined): boolean {
  return jobHasTraining(job)
}

/**
 * The modules a training card actually shows. Authored sections when the admin wrote them, the
 * built-in category coursebook otherwise — which is what makes "training card" mean "has modules"
 * rather than "the admin remembered to write some".
 */
export function jobTrainingModuleCount(job: { trainingRequired?: boolean; trainingNotes?: TrainingSection[] } | null | undefined): number {
  if (!job || !jobHasTraining(job)) return 0
  return (job.trainingNotes ?? []).filter((section) => section.title.trim() !== '' || section.content.trim() !== '').length
}

/**
 * The USD price of training for one job card. Admins set this per job; when the job carries no
 * fee of its own (older documents, seeded demo cards) the globally configured fee applies.
 * Unlike `getTrainingFeeUsd`, a per-job fee is taken at face value — no cents heuristic.
 * Kept to 4 decimal places so sub-dollar fees (e.g. 0.0077) survive the round trip.
 */
export function trainingFeeUsdFor(jobFeeUsd?: number | string | null): number {
  const num = Number(jobFeeUsd)
  if (Number.isFinite(num) && num > 0) return Math.round(num * 10000) / 10000
  return getTrainingFeeUsd()
}

/** KES checkout price for one job card's training: the per-job fee first, global config as fallback. */
export function trainingFeeKesFor(jobFeeUsd?: number | string | null): number {
  const num = Number(jobFeeUsd)
  if (Number.isFinite(num) && num > 0) {
    return Math.round((Math.round(num * 10000) / 10000) * getExchangeRateUsdToKes())
  }
  return getTrainingFeeKes()
}

/** Paystack subunits (KES cents) for one job card's training fee. */
export function paystackSubunitsFor(jobFeeUsd?: number | string | null): number {
  return trainingFeeKesFor(jobFeeUsd) * 100
}

/**
 * How many questions each built-in category bank carries. Kept in a client-safe module so the
 * admin console can show the real number without ever importing the answer key. The training
 * curriculum test checks this against `builtInQuestions()`.
 */
export const BUILT_IN_QUESTION_COUNT = 20

/**
 * Pass mark for an assessment of any length: 80% correct, rounded up.
 *
 * The built-in banks carry 20 applied questions, so a pass needs 16. This is deliberately stricter
 * than the old two-thirds threshold: every served question tests judgement under a brief, not
 * vocabulary recall, and a marginal pass should not unlock paid work.
 */
export function assessmentPassMark(questionCount: number): number {
  const n = Math.max(1, Math.floor(questionCount) || 1)
  return Math.max(1, Math.ceil((n * 4) / 5))
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

/**
 * Cards added in the 2026 catalogue expansion. Kept as an explicit list so the optional Firestore
 * seeding script can publish this batch without touching cards an operator already curated.
 */
export const EXPANDED_CATALOGUE_JOB_IDS = [
  'job-swahili-radio-interviews',
  'job-focus-group-transcription',
  'job-construction-ppe-label',
  'job-retail-shelf-label',
  'job-supplier-invoice-entry',
  'job-clinic-intake-entry',
  'job-marketplace-photo-review',
  'job-reported-comments-triage',
  'job-maternal-health-leaflets',
  'job-kikuyu-training-subtitles',
  'job-sacco-branch-verification',
  'job-grant-deadline-research',
] as const

/**
 * A second batch: cards with no training, and therefore no fee.
 *
 * A board made mostly of paid-training cards leaves a new member with nothing to start on until
 * they can pay, and nothing at all if they cannot. These are assessment-only cards — a verified
 * member goes straight to the assessment — so they are the cards that make the board usable before
 * any money changes hands.
 */
export const ASSESSMENT_ONLY_CATALOGUE_JOB_IDS = [
  'job-ai-description-check',
  'job-recipe-policy-screen',
  'job-drone-crop-tag',
  'job-packaging-defect-label',
  'job-radio-interview-transcription',
  'job-focus-group-overlap',
  'job-sacco-loan-register',
  'job-pharmacy-contact-verify',
  'job-county-health-translation',
  'job-app-onboarding-sheng',
] as const

/** Every id either import path is allowed to publish. */
export const IMPORTABLE_CATALOGUE_JOB_IDS = [
  ...EXPANDED_CATALOGUE_JOB_IDS,
  ...ASSESSMENT_ONLY_CATALOGUE_JOB_IDS,
] as const

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
      trainingRequired: true,
      trainingFeeUsd: 14,
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
      // Sample cards use the category bank. Answers live only in lib/assessment-bank.ts.
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
      trainingNotes: [
        {
          title: "The court transcript template",
          content:
            "Use the supplied page-and-line template exactly: a page number, a line number for every five lines of text, and a speaker label in capitals at each change. Never paraphrase a question, an objection or a ruling. Where the audio cannot support a word, write [inaudible 00:00:00] with the recorder timestamp and leave the gap visible rather than guessing from context.",
        },
        {
          title: "Legal terms, names and confidentiality",
          content:
            "Case citations, statute names and party names must match the glossary character for character; expand an abbreviation only where the glossary gives the expansion. Hearings contain sensitive testimony, so keep every file inside the task workspace, never quote a case elsewhere, and send ambiguous passages to the review thread with the clause and timestamp attached.",
        },
      ],
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
      trainingFeeUsd: 18,
      trainingNotes: [
        {
          title: "The street-scene taxonomy",
          content:
            "Label only the classes in the client taxonomy: car, van, truck, pedestrian and road sign. A tight box touches the outermost visible pixels of the object and stops at an occluder; it never includes road, shadow or a neighbouring object. A truncated object is boxed to the image edge, not completed by imagination.",
        },
        {
          title: "Calibration and rejected frames",
          content:
            "Your first five images are calibration images and are checked before the rest of the batch is released. If two labels disagree on the same object, stop and ask rather than picking one style. For a corrupted, duplicated or unreadable frame, skip it and record the file name in the exception queue; never invent an object to fill an empty image.",
        },
      ],
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
      trainingNotes: [
        {
          title: "Anatomical region protocol",
          content:
            "Annotate the lung fields, heart silhouette and diaphragm with the region tool named in the brief. Trace the visible border of each region and do not infer a border hidden by a device, a rib or poor exposure. This is a geometry task, not a diagnosis: no finding, impression or clinical label belongs in the annotation.",
        },
        {
          title: "Ambiguity and medical data handling",
          content:
            "If a region cannot be separated confidently, mark the image for radiologist review and move on. Never search for a patient name, never export an image, and never discuss a case outside the review thread. A single image copied for practice is still a confidentiality breach and ends the task.",
        },
      ],
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
      trainingFeeUsd: 16,
      trainingNotes: [
        {
          title: "Choosing the dominant land use",
          content:
            "Classify each tile by the dominant land use in the supplied legend: farmland, urban, forest, water or barren. Judge the whole tile, not the most colourful corner. A mixed tile is assigned by the brief's majority rule; if no class clearly dominates, use the low-confidence flag instead of forcing a class.",
        },
        {
          title: "Legend and seasonal traps",
          content:
            "Do not invent a class for a feature the legend does not contain. Dark water can resemble a shadow, and dry farmland can resemble barren land, so check the date and the surrounding tiles before deciding. Complete the calibration quiz first; a tile you cannot defend in one sentence goes to the exception queue.",
        },
      ],
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
      trainingFeeUsd: 15,
      trainingNotes: [
        {
          title: "Marketplace policy codes",
          content:
            "Every decision needs one policy code from the client list plus the listing ID. Prohibited items and misleading health or safety claims are removals; a vague claim that does not meet a code is allowed or sent to review, not removed on personal dislike. Read the title, photo and description together before choosing a code.",
        },
        {
          title: "Evidence notes and escalation",
          content:
            "Write a note a second reviewer can replay: policy code, the exact text or image region, and the action taken. Weapons, medicines with unsupported claims, and repeated listings from one seller are escalated rather than handled alone. Preserve the evidence before removing a listing, and never add a rule the client has not published.",
        },
      ],
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
      trainingFeeUsd: 16,
      trainingNotes: [
        {
          title: "The four-category matrix",
          content:
            "Classify each comment as safe, spam, hate speech or misinformation using the published definitions. Read the parent thread before deciding: a quoted slur in a condemnation is not an attack, while a reclaimed term used to target a person still violates the hate policy. When two categories appear to fit, choose the one that carries the stronger enforcement and explain why.",
        },
        {
          title: "Confidence, self-harm and escalation",
          content:
            "Confidence means how strongly the evidence supports your category, not how strongly you feel about the comment. A credible self-harm statement is escalated immediately through the safety path and is never handled by deleting the comment and moving on. Record the category, confidence, evidence and escalation target in the note.",
        },
      ],
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
      trainingFeeUsd: 22,
      trainingNotes: [
        {
          title: "Contract structure and defined terms",
          content:
            "Preserve clause numbering, headings, cross-references, defined terms and placeholders exactly as the source presents them. Use the approved glossary for every legal term; do not simplify a term of art into everyday language, because that can change the legal effect. Keep the source's defined-term capitalisation consistent in the target.",
        },
        {
          title: "Ambiguity and the review note",
          content:
            "When a clause is genuinely ambiguous, translate the most defensible reading and flag the clause number with the competing reading for the reviewer. Do not add a translator footnote unless the brief asks for one, and do not repair a defective cross-reference silently. Run a final pass for numbers, dates, parties and formatting before submission.",
        },
      ],
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
      trainingFeeUsd: 14,
      trainingNotes: [
        {
          title: "Sentiment decision rules",
          content:
            "Rate the review as a whole, not the loudest sentence. A review that praises the product but condemns delivery is mixed and must be flagged for spot-check rather than forced into positive or negative. Treat sarcasm and a star rating that contradicts the text as evidence to weigh, not as automatic answers.",
        },
        {
          title: "Topic taxonomy discipline",
          content:
            "Assign one primary topic from the supplied list. If the review covers two topics, choose the one the reviewer spends most words on and note the secondary topic only where the template allows it. Never invent a topic label, and never let a sentiment word decide the topic without reading what the review is actually about.",
        },
      ],
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
      trainingFeeUsd: 18,
      trainingNotes: [
        {
          title: "Reconciliation before correction",
          content:
            "The printed statement is the authority, not the extraction. Recompute subtotals and totals from the source figures and compare them with the extracted row. Two offsetting errors can leave a total looking perfect, so check row-level values as well as the bottom line before marking an extraction correct.",
        },
        {
          title: "Reason codes and escalation",
          content:
            "Every discrepancy needs the client reason code and the exact source location. Do not correct a figure unless the source clearly supports the correction; when the statement itself is inconsistent, preserve the printed value and flag the statement. Accuracy below the 95% threshold stops the batch for review rather than being averaged away.",
        },
      ],
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
      trainingFeeUsd: 16,
      trainingNotes: [
        {
          title: "Field boundaries and overlap",
          content:
            "Trace each field boundary as a polygon that follows the visible edge of the cultivated area, excluding tracks, buildings and tree lines unless the brief includes them. Separate adjacent fields at the shared boundary instead of drawing one merged polygon. Where a boundary is hidden, follow the visible evidence and flag the segment rather than inventing a straight line.",
        },
        {
          title: "Crop legend and calibration",
          content:
            "Tag each field with one crop class from the supplied legend. For a mixed field, use the brief's dominant-crop rule; if the imagery is too early or too late in the season to distinguish the crop, use the uncertain tag. Complete the calibration test before the full batch and keep the same class for the same field across frames.",
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(9),
      postedAgo: '2 days ago',
    },

    // ── Catalogue expansion · 2026 ───────────────────────────────────────────
    {
      id: 'job-swahili-radio-interviews',
      title: 'Transcribe Swahili radio interviews for a media archive',
      category: 'Transcription',
      description:
        'Eight recorded interviews from a county radio series, six to nine minutes each. The audio is clean, but callers, music beds and the occasional name are not. You get a speaker key, a names list and the station house style.',
      responsibilities: [
        'Transcribe eight interviews with host, guest and caller labels',
        'Add timestamps at every speaker change and music bed',
        'Verify names and places against the supplied list',
        'Tag genuinely unclear words instead of guessing',
      ],
      payAmountUsd: 42,
      estimatedMinutes: 300,
      capacity: 45,
      slotsRemaining: 34,
      trainingRequired: true,
      trainingFeeUsd: 12,
      trainingNotes: [
        {
          title: 'The archive uses clean verbatim',
          content:
            'Remove filler sounds and false starts, but keep every idea, every speaker turn and every music cue. A music bed is written as [music] with the timestamp where it starts and ends. Do not summarise a caller who rambles; transcribe what they said.\n\nUse the station format for every line:\n\n[00:02:14] Host: ...\n[00:02:19] Guest: ...\n\nTimestamps go at speaker changes, not on every line.',
        },
        {
          title: 'Names and places are facts',
          content:
            'The supplied names list wins. If a name is not on the list and you cannot hear it clearly, write [phonetic: ...] and flag the timestamp in your handover note. Do not choose the most familiar spelling.\n\nPlace names should follow the official spelling in the list, including the county and ward. If the speaker uses a nickname, transcribe the nickname and keep the official name in your note — never silently replace one with the other.',
        },
        {
          title: 'Before you submit',
          content:
            'Run this check in order:\n- Every speaker change starts a new line with a label\n- Every music bed has a start and end timestamp\n- Every uncertain name is tagged, not guessed\n- The file follows the station format and the agreed file name\n\nIf any box is unchecked, the archive will return the file even when the words themselves are correct.',
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(7),
      postedAgo: '3 hours ago',
    },
    {
      id: 'job-focus-group-transcription',
      title: 'Transcribe market-research focus groups with overlapping speech',
      category: 'Transcription',
      description:
        'Six focus-group sessions (45–55 minutes) with five or six participants, mixed English and Swahili, and frequent crosstalk. The client needs a usable speaker map and a faithful record for analysis.',
      responsibilities: [
        'Build a speaker map before typing the first line',
        'Transcribe six sessions with participant labels',
        'Mark crosstalk with the client convention and timecodes',
        'Deliver clean verbatim plus a short uncertainty log',
      ],
      payAmountUsd: 78,
      estimatedMinutes: 480,
      capacity: 18,
      slotsRemaining: 11,
      trainingRequired: true,
      trainingFeeUsd: 24,
      trainingNotes: [
        {
          title: 'Build the speaker map before the first line',
          content:
            'Groups are not interviews. Participants talk over each other, agree with a murmur, and switch between English and Swahili mid-sentence. Read the participant list and listen to the first two minutes before typing, then assign one label per voice and keep it for the whole session.\n\nWhen two people speak at once, keep both audible contributions and mark the overlap with the client convention, for example [crosstalk 00:12:04]. Do not award the line to the louder voice. If a contribution is truly unintelligible, tag it and log the timestamp instead of inventing words.',
        },
        {
          title: 'The mixed-language rule',
          content:
            'Transcribe each language as spoken. Do not translate Swahili into English and do not anglicise a name or a phrase because the rest of the sentence is English. The analyst needs the participant’s actual words.\n\nKeep the supplied glossary open for recurring programme terms. If a term is not in the glossary and you are unsure of the spelling, use [phonetic: ...] and add it to the uncertainty log. A clean uncertainty log is part of the deliverable, not an apology.',
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(12),
      postedAgo: '1 day ago',
    },

    {
      id: 'job-construction-ppe-label',
      title: 'Label construction-site photos for PPE and hazard detection',
      category: 'Image Labeling',
      description:
        'Annotate 240 construction-site photographs with boxes for helmets, high-visibility vests, ladders, scaffolds and open edges. The taxonomy includes an edge-case gallery for occlusion, distance and motion blur.',
      responsibilities: [
        'Draw tight boxes around every visible instance in 240 images',
        'Apply the taxonomy and the occlusion rule from the gallery',
        'Pass a ten-image calibration batch before the main set',
        'Send unreadable or ambiguous frames to the unsure queue',
      ],
      payAmountUsd: 54,
      estimatedMinutes: 330,
      capacity: 60,
      slotsRemaining: 46,
      trainingRequired: true,
      trainingFeeUsd: 14,
      trainingNotes: [
        {
          title: 'Label what is visible, not what you expect',
          content:
            'A tight box follows the visible edge of the helmet, vest, ladder or open edge. If a worker is partly behind a stack of blocks, box the visible part and apply the occluded-object rule in the gallery; never extend a box into the hidden area. A high-visibility vest counts as one instance even when the straps and reflective bands are separate.\n\nSmall or distant objects still get a box when they meet the minimum pixel size. If they do not, skip them and note why. The calibration batch is the authority for edge cases, not a guess from a similar image.',
        },
        {
          title: 'When an image is a safety signal',
          content:
            'Some frames show an obvious hazard: a worker on an unguarded edge, a ladder at the wrong angle, or someone welding without a shield. Your job is to label the objects, not to certify the site. Record the hazard with the approved hazard tag and put the frame in the review queue.\n\nDo not crop, enhance or annotate in a way that hides the scene. Do not copy a site image outside the task. The client uses these frames for model training and safety review, and an edited image destroys both uses.',
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(8),
      postedAgo: '5 hours ago',
    },
    {
      id: 'job-retail-shelf-label',
      title: 'Annotate retail shelf images for stock detection',
      category: 'Image Labeling',
      description:
        'Draw product facings and shelf gaps on 300 store photographs. The client supplies a category list and planogram examples; consistency across a shelf matters more than perfect speed.',
      responsibilities: [
        'Box every visible product facing in 300 shelf images',
        'Mark empty shelf gaps with the approved gap label',
        'Flag price tags that are too blurry to read',
        'Keep one class list and one box style across the batch',
      ],
      payAmountUsd: 40,
      estimatedMinutes: 260,
      capacity: 80,
      slotsRemaining: 63,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(5),
      postedAgo: '9 hours ago',
    },

    {
      id: 'job-supplier-invoice-entry',
      title: 'Key supplier invoices into an accounts template',
      category: 'Data Entry',
      description:
        'Enter 140 scanned supplier invoices into a fixed accounts template: invoice number, date, supplier, subtotal, VAT, total, currency and purchase-order reference. Scans vary in layout, and a few contain handwritten corrections.',
      responsibilities: [
        'Enter the required fields for 140 invoices',
        'Copy the printed figures; do not repair the supplier arithmetic',
        'Send contradictions and missing pages to the exception queue',
        'Verify VAT and total digits on a second pass',
      ],
      payAmountUsd: 36,
      estimatedMinutes: 240,
      capacity: 75,
      slotsRemaining: 60,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(4),
      postedAgo: '6 hours ago',
    },
    {
      id: 'job-clinic-intake-entry',
      title: 'Digitise clinic intake forms under a confidentiality brief',
      category: 'Data Entry',
      description:
        'Key 180 handwritten patient intake forms into a secure structured template. You will enter only the approved fields, use exception codes for missing or illegible answers, and keep every record inside the platform.',
      responsibilities: [
        'Enter the approved fields for 180 intake forms',
        'Use the supplied exception codes for blanks and unreadable answers',
        'Double-check patient identifiers and visit dates',
        'Never copy, photograph or discuss a record outside the task',
      ],
      payAmountUsd: 60,
      estimatedMinutes: 360,
      capacity: 28,
      slotsRemaining: 19,
      trainingRequired: true,
      trainingFeeUsd: 18,
      trainingNotes: [
        {
          title: 'Minimum data, maximum care',
          content:
            'Enter only the columns in the template. Do not add a diagnosis, a phone number or a note that the form did not ask for. If a field is blank, use the approved blank code; if handwriting is ambiguous, use the unclear code and move on.\n\nPatient information never leaves this task. No screenshots, no personal notes, no pasting into another app, no discussion outside the review thread. A record copied for convenience is still a breach.',
        },
        {
          title: 'Reading handwritten forms consistently',
          content:
            'The source document is the authority. Copy the name and date as printed; if the form mixes day-first and month-first dates, apply the conversion rule in the brief and record the original in the exception note.\n\nCheck identifiers twice: one wrong digit can attach a visit to the wrong person. When two fields disagree, stop and flag the row rather than choosing the one that looks more likely.',
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(9),
      postedAgo: '1 day ago',
    },

    {
      id: 'job-marketplace-photo-review',
      title: 'Review marketplace photos for prohibited and misleading items',
      category: 'Content Review',
      description:
        'Review 300 marketplace listings that combine a photo, a title and a short description. Apply the client policy to decide allow, review, remove or escalate, and record the policy reason for every decision.',
      responsibilities: [
        'Review 300 listings against the policy categories',
        'Record one policy code and a short evidence note per decision',
        'Escalate weapons, medical claims and coordinated repeat listings',
        'Keep the queue moving without inventing rules',
      ],
      payAmountUsd: 44,
      estimatedMinutes: 220,
      capacity: 70,
      slotsRemaining: 54,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(6),
      postedAgo: '4 hours ago',
    },
    {
      id: 'job-reported-comments-triage',
      title: 'Triage reported comments for a community platform',
      category: 'Content Review',
      description:
        'Work through 450 reported comments covering harassment, hate, spam and self-harm risk. The queue gives you the comment, its surrounding thread and the report reason; the severity matrix tells you what to do next.',
      responsibilities: [
        'Triage 450 reports with the severity matrix',
        'Read the full thread before deciding on context-dependent cases',
        'Escalate credible threats and self-harm risk immediately',
        'Write a reviewable note for every removal or escalation',
      ],
      payAmountUsd: 70,
      estimatedMinutes: 320,
      capacity: 32,
      slotsRemaining: 23,
      trainingRequired: true,
      trainingFeeUsd: 15,
      trainingNotes: [
        {
          title: 'Severity before wording',
          content:
            'The report reason is a starting point, not the decision. Read the comment in its thread, then apply the severity matrix: credible threat or self-harm risk goes to escalation immediately; targeted abuse gets removal and the appropriate policy code; ordinary disagreement stays up even when it is rude.\n\nDo not let a polite sentence hide a threat, and do not treat a rude word as a violation by itself. When two rules could apply, record the more specific one so the policy team can audit the call.',
        },
        {
          title: 'Write the note a reviewer can defend',
          content:
            'Every removal or escalation needs a short note that names the rule and the evidence: which words, which image, which part of the thread. “Offensive” is not a reason code. “Targeted harassment — repeated personal insults after the user asked them to stop” is.\n\nKeep the note factual and free of personal opinion. If you are unsure, send the case to review rather than guessing at removal; a second look is cheaper than an unfair enforcement decision.',
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(10),
      postedAgo: '2 days ago',
    },

    {
      id: 'job-maternal-health-leaflets',
      title: 'Translate maternal-health leaflets EN → Swahili',
      category: 'Translation',
      description:
        'Translate 20 maternal-health leaflets (300–600 words each) from English into clear, respectful Swahili for community clinics. A clinical glossary and two approved reference leaflets are provided.',
      responsibilities: [
        'Translate all 20 leaflets with the approved glossary',
        'Preserve headings, warnings, numbers and reading level',
        'Keep medical advice exactly as written — add none of your own',
        'Flag ambiguous clinical terms instead of choosing silently',
      ],
      payAmountUsd: 48,
      estimatedMinutes: 280,
      capacity: 40,
      slotsRemaining: 30,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(7),
      postedAgo: '8 hours ago',
    },
    {
      id: 'job-kikuyu-training-subtitles',
      title: 'Create Kikuyu subtitles for short training videos',
      category: 'Translation',
      description:
        'Create timed Kikuyu subtitles for 14 training videos (three to five minutes each). The client supplies a terminology glossary, character limits and two worked examples; the audio is clear and the speakers are identified.',
      responsibilities: [
        'Subtitle 14 videos with accurate timecodes',
        'Keep every subtitle within the two-line, 42-character limit',
        'Use the glossary for recurring terms and names',
        'Translate meaning and tone, not word-for-word idioms',
      ],
      payAmountUsd: 74,
      estimatedMinutes: 420,
      capacity: 24,
      slotsRemaining: 17,
      trainingRequired: true,
      trainingFeeUsd: 22,
      trainingNotes: [
        {
          title: 'Subtitle timing and reading speed',
          content:
            'A subtitle must be readable before it disappears. Keep each cue to one or two lines, no more than 42 characters per line, and aim for a comfortable reading speed rather than cramming every word into one frame.\n\nSplit at natural phrase boundaries. Never leave a one-word line unless the speaker deliberately pauses on it. If a sentence cannot fit, shorten the wording without dropping a fact, a warning or a name, and keep the timecode on the spoken phrase.',
        },
        {
          title: 'Kikuyu terminology and tone',
          content:
            'Use the supplied glossary for recurring terms. When a term is not in the glossary, translate the meaning rather than inventing a new word, and add it to your handover note so the next video stays consistent.\n\nIdioms and proverbs should carry the same effect in Kikuyu, not a literal image that confuses the viewer. Keep the trainer’s register: direct, practical and respectful. Do not add explanation that the speaker did not give.',
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(11),
      postedAgo: '1 day ago',
    },

    {
      id: 'job-sacco-branch-verification',
      title: 'Verify SACCO branch contacts from official sources',
      category: 'Research',
      description:
        'Verify branch details for 90 savings and credit cooperatives: branch name, physical address, phone, email and official source URL. Use the institution website, regulator listings or an official annual report — not a directory or social post.',
      responsibilities: [
        'Verify 90 branch records from official sources',
        'Record the exact page URL and the date you checked it',
        'Mark closed, merged or unverifiable branches',
        'Normalise phone numbers to the requested format',
      ],
      payAmountUsd: 32,
      estimatedMinutes: 260,
      capacity: 60,
      slotsRemaining: 47,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(5),
      postedAgo: '7 hours ago',
    },
    {
      id: 'job-grant-deadline-research',
      title: 'Compile verified grant deadlines for small NGOs',
      category: 'Research',
      description:
        'Build a verified list of 55 grant opportunities for small East African NGOs: funder, programme, deadline, eligibility, award range and the official application page. Aggregator sites are leads, not evidence.',
      responsibilities: [
        'Verify 55 opportunities on the funder’s official page',
        'Record the deadline and its timezone exactly as published',
        'Mark rolling, invite-only and closed programmes',
        'Flag conflicts between an aggregator and the funder',
      ],
      payAmountUsd: 56,
      estimatedMinutes: 320,
      capacity: 35,
      slotsRemaining: 26,
      trainingRequired: true,
      trainingFeeUsd: 12,
      trainingNotes: [
        {
          title: 'Official sources, in order',
          content:
            'Start with the funder’s own programme page, then its published guidelines or annual report, then a regulator or government notice. An aggregator, newsletter or social post is a lead that tells you where to look — never the evidence you record.\n\nCopy the exact page URL you checked and the date you checked it. If the page has moved, follow the official redirect and record the final URL. A dead link or a PDF that cannot be opened is an unverifiable row, not a deadline to guess.',
        },
        {
          title: 'A deadline is a timezone fact',
          content:
            'Record the deadline exactly as published, including the time and timezone. “30 November” without a timezone is incomplete when the funder closes at 23:59 EST. Keep the funder’s wording beside your normalised date so an NGO can check it.\n\nMark rolling, invite-only, suspended and closed programmes explicitly. If an aggregator and the funder disagree, the funder wins and you note the conflict. Do not add an opportunity you cannot trace to an official page.',
        },
      ],
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(9),
      postedAgo: '1 day ago',
    },
    // ── Assessment-only additions ────────────────────────────────────────────
    // Cards with no training, and therefore no fee: a verified member goes straight to the
    // assessment. These exist because a board that is mostly paid-training cards gives a new
    // member nothing to start on until they can pay.
    {
      id: 'job-ai-description-check',
      title: 'Check AI-written product descriptions against source specs',
      category: 'Content Review',
      description:
        'A retailer generates product descriptions with AI and needs a human to catch what the model invented. Compare each description against the supplied spec sheet and mark anything the source does not support.',
      responsibilities: [
        'Check 60 AI-written descriptions against their spec sheets',
        'Flag claims the source does not support',
        'Mark invented dimensions, materials or compatibility',
        'Return a short correction for each flagged claim',
      ],
      payAmountUsd: 30,
      estimatedMinutes: 220,
      capacity: 80,
      slotsRemaining: 63,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(6),
      postedAgo: '3 hours ago',
    },
    {
      id: 'job-recipe-policy-screen',
      title: 'Screen submitted recipes for copied text and policy breaches',
      category: 'Content Review',
      description:
        'Review user-submitted recipes before publication. You are checking three things: text copied from another site, unsafe food-handling advice, and ingredients or claims the policy forbids. Full policy and examples are supplied.',
      responsibilities: [
        'Screen 50 submitted recipes against the policy',
        'Flag copied text with the source you matched it to',
        'Flag unsafe handling advice and forbidden claims',
        'Approve, flag or reject each submission with a reason',
      ],
      payAmountUsd: 26,
      estimatedMinutes: 200,
      capacity: 70,
      slotsRemaining: 54,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(7),
      postedAgo: '9 hours ago',
    },
    {
      id: 'job-drone-crop-tag',
      title: 'Tag crop types in drone field photos',
      category: 'Image Labeling',
      description:
        'Tag the crop in each drone-captured field photo using the supplied eight-class guide. Fields are photographed from above, so expect partial occlusion and mixed boundaries between neighbouring plots.',
      responsibilities: [
        'Tag 120 drone field photos by crop type',
        'Follow the eight-class guide exactly',
        'Mark mixed-boundary photos rather than forcing one class',
        'Skip and report blurred or unusable frames',
      ],
      payAmountUsd: 32,
      estimatedMinutes: 200,
      capacity: 90,
      slotsRemaining: 71,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(5),
      postedAgo: '1 day ago',
    },
    {
      id: 'job-packaging-defect-label',
      title: 'Label defects on manufactured packaging',
      category: 'Image Labeling',
      description:
        'Mark print and packaging defects on photos of finished cartons: misregistration, smearing, tears, creases and missing panels. A tight box on each defect; one photo can carry several.',
      responsibilities: [
        'Label defects on 100 packaging photos',
        'Use the five defect classes in the supplied guide',
        'Allow multiple defects per photo',
        'Record severity for each marked defect',
      ],
      payAmountUsd: 34,
      estimatedMinutes: 210,
      capacity: 100,
      slotsRemaining: 82,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(8),
      postedAgo: '2 days ago',
    },
    {
      id: 'job-radio-interview-transcription',
      title: 'Transcribe Swahili radio interviews',
      category: 'Transcription',
      description:
        'Transcribe recorded radio interviews in Swahili, 10 to 15 minutes each. Presenters switch between Swahili and English mid-sentence, and callers phone in with varying audio quality.',
      responsibilities: [
        'Transcribe 8 radio interviews verbatim',
        'Label presenter and caller separately',
        'Transcribe each language as spoken, without translating',
        'Flag inaudible passages with the recorder timestamp',
      ],
      payAmountUsd: 24,
      estimatedMinutes: 190,
      capacity: 65,
      slotsRemaining: 51,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(6),
      postedAgo: '5 hours ago',
    },
    {
      id: 'job-focus-group-overlap',
      title: 'Transcribe focus-group recordings with overlapping speakers',
      category: 'Transcription',
      description:
        'Transcribe focus-group recordings where participants talk over each other. You are producing a readable record of who said what, so overlaps must be attributed rather than flattened into one line.',
      responsibilities: [
        'Transcribe 5 focus-group recordings (15-20 min each)',
        'Attribute overlapping speech to each speaker',
        'Mark an unclear attribution rather than guessing',
        'Keep filler words only where they change the meaning',
      ],
      payAmountUsd: 38,
      estimatedMinutes: 240,
      capacity: 45,
      slotsRemaining: 36,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(9),
      postedAgo: '2 days ago',
    },
    {
      id: 'job-sacco-loan-register',
      title: 'Enter SACCO member applications into the loan register',
      category: 'Data Entry',
      description:
        'Enter loan applications into the SACCO loan register from scanned forms. Fields are fixed and validation rules are supplied; a form that fails a rule is queued for a human rather than corrected by you.',
      responsibilities: [
        'Enter 70 loan applications from scanned forms',
        'Apply the supplied field validation rules',
        'Queue failed forms with the rule that failed',
        'Keep member identifiers exactly as printed',
      ],
      payAmountUsd: 18,
      estimatedMinutes: 150,
      capacity: 110,
      slotsRemaining: 88,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(4),
      postedAgo: '1 day ago',
    },
    {
      id: 'job-pharmacy-contact-verify',
      title: 'Verify pharmacy contact details from county records',
      category: 'Research',
      description:
        'Verify pharmacy names, addresses, phone numbers and licence numbers against county health records. Where a record is missing or contradicted, mark it unverified rather than filling the gap from a directory.',
      responsibilities: [
        'Verify 80 pharmacy records against county records',
        'Record the source document and date checked',
        'Mark unverified rather than guessing',
        'Normalise phone numbers to the requested format',
      ],
      payAmountUsd: 22,
      estimatedMinutes: 170,
      capacity: 80,
      slotsRemaining: 62,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(7),
      postedAgo: '11 hours ago',
    },
    {
      id: 'job-county-health-translation',
      title: 'Translate county health announcements into Kiswahili',
      category: 'Translation',
      description:
        'Translate short county health announcements from English into Kiswahili. These go out to the public, so a dosage, an age limit or a clinic time must survive the translation exactly.',
      responsibilities: [
        'Translate 40 county announcements into Kiswahili',
        'Preserve every number, dose, date and time exactly',
        'Use the supplied term list for clinical terms',
        'Flag an English sentence you cannot translate safely',
      ],
      payAmountUsd: 28,
      estimatedMinutes: 200,
      capacity: 75,
      slotsRemaining: 59,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(5),
      postedAgo: '4 hours ago',
    },
    {
      id: 'job-app-onboarding-sheng',
      title: 'Localise app onboarding strings into Sheng',
      category: 'Translation',
      description:
        'Localise short app onboarding strings into Sheng, the mixed Swahili and English register younger urban speakers use. Tone matters as much as accuracy, and a string that reads stiff is a failed string.',
      responsibilities: [
        'Localise 60 onboarding strings into Sheng',
        'Keep each string within the supplied character limit',
        'Keep placeholders and variables untouched',
        'Flag any string with no natural Sheng equivalent',
      ],
      payAmountUsd: 25,
      estimatedMinutes: 190,
      capacity: 70,
      slotsRemaining: 55,
      trainingRequired: false,
      requiresVerified: true,
      status: 'open',
      closesAt: daysFromNow(8),
      postedAgo: '1 day ago',
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
