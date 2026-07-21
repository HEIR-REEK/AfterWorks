// Minimal in-repo data + helpers used by the demo app.

export type JobCategory =
  | 'Data Entry'
  | 'Transcription'
  | 'Image Labeling'
  | 'Content Review'
  | 'Translation'
  | 'Research'

export type JobStatus = 'open' | 'paused' | 'closed'

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

export type WorkerProfile = {
  name: string
  email: string
  location: string
  accountState: 'active'
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
}

export type Wallet = {
  pendingUsd: number
  availableUsd: number
  payoutNumber: string
}

// Approx display rate; spec says KES shown at withdrawal-time rate.
export const USD_TO_KES = 129

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function formatKes(usd: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(usd * USD_TO_KES)
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
    name: 'Amara Okoro',
    email: 'amara.okoro@afterworks.io',
    location: 'Nairobi, Kenya',
    accountState: 'active',
    kycVerified: true,
    qualityScore: 98,
    jobsCompleted: 14,
    memberSince: 'Mar 2025',
    phone: '+254 712 345 678',
    bio: 'Experienced data annotator, Swahili/English translator & audio transcription specialist with 2+ years in digital micro-tasking.',
    skills: ['Swahili Transcription', 'Data Entry', 'Image Bounding Box', 'Medical Glossary', 'Content Moderation'],
    languages: ['English (Native/Fluent)', 'Swahili (Native)', 'Kikuyu (Fluent)'],
    preferredPayoutMethod: 'M-Pesa',
  }
}

export function seedWallet(): Wallet {
  return {
    pendingUsd: 22,
    availableUsd: 46,
    payoutNumber: '+254 7•• ••• 481',
  }
}

// One pre-existing application so the tracker isn't empty on first load.
export function seedApplications(): Application[] {
  const applied = new Date()
  applied.setDate(applied.getDate() - 1)
  return [
    {
      id: 'app-seed-1',
      jobId: 'job-data-entry',
      status: 'in_progress',
      appliedAt: applied.toISOString(),
      reviewExpiresAt: daysFromNow(1),
      history: [
        { status: 'under_review', at: applied.toISOString() },
        { status: 'approved', at: applied.toISOString() },
        { status: 'in_progress', at: new Date().toISOString() },
      ],
    },
  ]
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
