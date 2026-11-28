/**
 * Region-scoped job cards — the seeded content each region's board opens on.
 *
 * Six cards per region — one in every category on the platform — each with its own training
 * sections, its own training fee and **its own assessment**. A board that only carried three
 * categories left that region with no Transcription, Image Labeling or Translation work at all.
 *
 * The assessment matters more than it looks: each card here carries twenty authored questions,
 * because `lib/assessment-bank.ts` deliberately returns an empty bank for a category rather than
 * serving an easy quiz, and a card whose id is not in the bank would otherwise refuse every attempt
 * with "this job has no assessment".
 *
 * The copy is written from each region's own market — the money habits, the labelling rules, the
 * data-residency question — so a board is not the African card with a different label. See
 * `MARKET_DETAIL`.
 *
 * Prices follow the tiering the platform asked for: the Americas highest, then Europe, then Asia,
 * and Africa lowest. The gap is not cosmetic — it is the reason the boards are locked to a region in
 * the first place, and `validateRegionalPay` refuses a card where Africa out-prices the others.
 *
 * These are *seed* cards. A live deployment publishes them through `IMPORTABLE_CATALOGUE_JOB_IDS`
 * exactly like the existing expansion batch, so an operator can review them in the console before
 * anyone sees them.
 */

import type { AssessmentQuestion, Job, TrainingSection } from '@/lib/afterworks-data'
import type { JobRegion } from '@/lib/job-regions'
import { regionalJobId } from '@/lib/job-regions'

const REGION_FEE: Record<JobRegion, number> = {
  Africa: 4,
  Americas: 12,
  Europe: 10,
  Asia: 7,
}

function sections(region: JobRegion, intro: string, standards: string, delivery: string): TrainingSection[] {
  return [
    {
      title: 'What this queue is',
      unit: `Unit 1 · ${JOB_UNIT_NAMES[region]}`,
      kind: 'concept',
      objective: 'Understand who the client is and what a good output looks like for this queue.',
      durationMinutes: 6,
      content: intro,
    },
    {
      title: 'Standards you will be scored against',
      unit: `Unit 2 · Method & standards`,
      kind: 'scenario',
      objective: 'Apply the written rules to a messy example without inventing anything.',
      durationMinutes: 8,
      content: standards,
    },
    {
      title: 'Submitting and getting paid',
      unit: `Unit 3 · Delivery`,
      kind: 'checkpoint',
      objective: 'Know exactly what to submit and how the payout reaches you.',
      durationMinutes: 4,
      content: delivery,
    },
  ]
}

/**
 * The market detail each board's new cards are written from.
 *
 * This is the part that makes a region's catalogue its own rather than the same card relabelled: a
 * transcription queue in Kenya is Sheng and M-Pesa receipts, in the Americas it is Spanish-English
 * calls and US state tax names, in Europe it is an EU data-residency answer, in Asia it is a
 * WhatsApp-first support thread. The work and the standard are the same; the mess is local.
 */
const MARKET_DETAIL: Record<
  JobRegion,
  {
    /** How people actually talk in this market's support calls. */
    speech: string
    /** The money wording a transcription or label queue meets. */
    money: string
    /** Where the consumer rules a label queue is graded against come from. */
    labelRules: string
    /** What a shelf-label queue has to survive, beyond the barcode. */
    shelf: string
    /** The compliance question a translation queue has to answer differently per market. */
    residency: string
    /** What makes this market's marketplace policy different from the others. */
    reviewPolicy: string
    /** The language pair this board's translation card is authored for. */
    pair: string
  }
> = {
  Africa: {
    speech: 'Sheng and English in the same sentence, with M-Pesa confirmations read out mid-call ("nimetuma elfu mbili") that must be transcribed as they are spoken, not tidied into English',
    money: 'shillings written four different ways — "KSh 1,200", "1,200/-", "1200 Ksh" and "elfu moja na mia mbili"',
    labelRules: 'the county weights-and-measures rules on net weight and the KEBS mark, which must be visible on the pack photo before a label is approved',
    shelf: 'a price tag that is handwritten on the shelf edge while the till shows a different number',
    residency: 'whether the client may hold Kenyan customer data outside Kenya, which turns on the Data Protection Act 2019 and its cross-border transfer rule',
    pair: 'Swahili and English',
    reviewPolicy:
      "the Data Protection Act 2019 consent wording and the local herbal-remedy claim rules, which are stricter than the imported supplements suggest",
  },
  Americas: {
    speech: 'Spanish and English code-switching within a call, plus spelled-out state names and ZIP codes that must not be normalised to a different state',
    money: 'US dollars written as "$1,200.00", "1,200 USD" and "twelve hundred", with a sales-tax line that differs by state',
    labelRules: 'the FDA nutrition-panel layout and the US net-quantity declaration, both of which are format rules before they are content rules',
    shelf: 'a shelf price that excludes local sales tax while the online listing includes it',
    residency: 'whether the client may process US customer data outside the United States, which is a contract question more often than a statute',
    pair: 'Spanish and English',
    reviewPolicy:
      'the FTC substantiation standard for health claims and the state rules on what a sale price may claim',
  },
  Europe: {
    speech: 'English as a second language across several accents, with euro amounts dictated in two languages in the same call',
    money: 'euros written "€1.200,00" in one country and "1,200.00 EUR" in another, where the separator meanings swap',
    labelRules: "the EU FIC allergen emphasis rule and the member state's own language requirement for the label",
    shelf: 'a price that includes VAT on the shelf and excludes it on the invoice',
    residency: 'whether the client may move EU personal data to a third country, which turns on GDPR Chapter V and the transfer mechanism named in the contract',
    pair: 'German and English',
    reviewPolicy:
      "the EU nutrition-and-health-claims register and the member state's own language requirement for mandatory information",
  },
  Asia: {
    speech: 'English, Mandarin and Malay mixed in one support thread, with amounts dictated in the local currency and then repeated in USD',
    money: 'amounts written in local currency and USD in the same sentence, at a rate the speaker states but does not date',
    labelRules: "the importing country's own labelling language requirement and its net-weight tolerance for the pack size",
    shelf: 'a promo price that is conditional on a membership the shopper may not hold',
    residency: 'whether the client may hold customer data outside the jurisdiction it was collected in, which differs by country on this board',
    pair: 'Mandarin and English',
    reviewPolicy:
      "the importing country's registration requirement for health products and the platform-specific rules on sale price claims",
  },
}

const JOB_UNIT_NAMES: Record<JobRegion, string> = {
  Africa: 'African queues',
  Americas: 'Americas queues',
  Europe: 'European queues',
  Asia: 'Asian queues',
}

/** Build one region's six cards. Kept as a function so ids and region fields cannot drift. */
type RegionPay = {
  data: number
  review: number
  research: number
  transcription: number
  labels: number
  translation: number
}

function cardsForRegion(region: JobRegion, pay: RegionPay): Job[] {
  const fee = REGION_FEE[region]
  const closesAt = new Date(Date.now() + 21 * 86400_000).toISOString()

  return [
    {
      id: regionalJobId(region, 'invoice-entry'),
      title: `Enter supplier invoices from ${JOB_REGION_LABELS[region]} clients`,
      category: 'Data Entry',
      region,
      description:
        `A monthly batch of scanned supplier invoices from ${JOB_REGION_LABELS[region]} clients, entered into a fixed accounts template. The scans carry ${MARKET_DETAIL[region].money}; some are skewed, a few carry handwritten corrections, and two are deliberately the same invoice filed twice.`,
      responsibilities: [
        'Enter 60 invoices into the provided template, one row each',
        'Convert every date to ISO 8601 and every amount to two decimals',
        'Flag duplicate invoices instead of deleting them',
      ],
      payAmountUsd: pay.data,
      estimatedMinutes: 180,
      capacity: 40,
      slotsRemaining: 33,
      trainingRequired: true,
      trainingFeeUsd: fee,
      trainingNotes: sections(
        region,
        `These are real supplier invoices from businesses operating in ${JOB_REGION_LABELS[region]}. The template is fixed: supplier, invoice number, date, subtotal, tax, total. You are not deciding what is owed — you are copying what the paper says, exactly, in a shape a bookkeeper can reconcile.`,
        'The rules that cost workers marks: dates stay as written unless the brief names a format; a duplicate key is supplier + invoice number + date + total, and a different line description does not settle it; never "fix" a total that looks wrong — flag it. Guessing is a failure even when the guess is right.',
        'Submit the finished spreadsheet and a short list of anything you flagged. Payment is released after QA, and yours arrives by the payout method on your profile — M-Pesa for Kenya, bank transfer or PayPal elsewhere.',
      ),
      assessmentQuestions: invoiceQuestions(region),
      requiresVerified: true,
      status: 'open',
      closesAt,
      postedAgo: '2 days ago',
    },
    {
      id: regionalJobId(region, 'content-review'),
      title: `Review ${JOB_REGION_LABELS[region]} marketplace listings for policy breaches`,
      category: 'Content Review',
      region,
      description:
        `Review a queue of product listings for a marketplace operating in ${JOB_REGION_LABELS[region]}. The policy is written for that market — ${MARKET_DETAIL[region].reviewPolicy}. Mark breaches, leave the rest alone, and record a one-line reason for every removal.`,
      responsibilities: [
        'Review 120 listings against a nine-rule policy sheet',
        'Tag breaches by rule number, not by opinion',
        'Escalate anything that looks like a counterfeit or a safety issue',
      ],
      payAmountUsd: pay.review,
      estimatedMinutes: 210,
      capacity: 30,
      slotsRemaining: 26,
      trainingRequired: true,
      trainingFeeUsd: fee,
      trainingNotes: sections(
        region,
        `The client sells into ${JOB_REGION_LABELS[region]} and the policy is written for that market's rules: what can be claimed about a health product, what counts as a prohibited category, what a "Genuine" badge requires. Policy is applied as written, not as you would write it.`,
        'Two rules decide most disagreements: over-removal is a failure (you cost the client a sale), and under-removal is a failure (you expose them to a regulator). When the sheet is silent you escalate; you do not improvise. Every removal needs the rule number in its reason field.',
        'Submit your decisions plus the escalation list. QA samples removals and non-removals equally, because a reviewer who removes nothing is as wrong as one who removes everything.',
      ),
      assessmentQuestions: reviewQuestions(region),
      requiresVerified: true,
      status: 'open',
      closesAt,
      postedAgo: '4 days ago',
    },
    {
      id: regionalJobId(region, 'market-research'),
      title: `Compile a competitor price sheet for ${JOB_REGION_LABELS[region]} retailers`,
      category: 'Research',
      region,
      description:
        `Build a price comparison for a client entering ${JOB_REGION_LABELS[region]}. Twenty named retailers, four products each, with the shelf price, the promo price and the date you checked — the comparison has to survive ${MARKET_DETAIL[region].shelf}, which is what makes this market its own job.`,
      responsibilities: [
        'Record 80 price points in the supplied sheet',
        'Note promo conditions (minimum spend, membership, dates) in the notes column',
        'Mark anything you could not confirm as unavailable rather than估 guessing',
      ],
      payAmountUsd: pay.research,
      estimatedMinutes: 240,
      capacity: 25,
      slotsRemaining: 20,
      trainingRequired: true,
      trainingFeeUsd: fee,
      trainingNotes: sections(
        region,
        `The deliverable is a decision input: a client will set their ${JOB_REGION_LABELS[region]} launch price from this sheet. A price you did not see is worse than a blank, because it will be trusted.`,
        'Currency belongs in its own column, never baked into the price. A promo price without its condition is a wrong number: "KSh 450, members only" is not "KSh 450". Record the date you checked, because a sheet with no dates cannot be audited.',
        'Submit the sheet and a note on the three hardest data points to find. Research pay is per completed sheet, not per hour.',
      ),
      assessmentQuestions: researchQuestions(region),
      requiresVerified: true,
      status: 'open',
      closesAt,
      postedAgo: '1 week ago',
    },
    {
      id: regionalJobId(region, 'call-transcription'),
      title: `Transcribe ${JOB_REGION_LABELS[region]} customer support calls`,
      category: 'Transcription',
      region,
      description: `Ten recorded support calls from a ${JOB_REGION_LABELS[region]} call centre, transcribed with speaker turns, timestamps every thirty seconds and verbatim amounts. The audio is real: background noise, overlapping speakers and numbers spoken aloud.`,
      responsibilities: [
        'Transcribe 10 calls, speaker-labelled, timestamps every 30 seconds',
        'Write amounts and phone numbers exactly as spoken, then as digits in the notes column',
        'Mark unintelligible passages as [inaudible] rather than reconstructing them',
      ],
      payAmountUsd: pay.transcription,
      estimatedMinutes: 200,
      capacity: 35,
      slotsRemaining: 29,
      trainingRequired: true,
      trainingFeeUsd: fee,
      trainingNotes: sections(
        region,
        `The calls come from a ${JOB_REGION_LABELS[region]} support line, so the audio carries ${MARKET_DETAIL[region].speech}. Your transcript is evidence in a dispute about what a customer was promised, which is why verbatim matters more than readable.`,
        'Clean up grammar and the transcript stops being evidence. Two conventions decide most QA findings: a number spoken aloud is transcribed as spoken and repeated as digits, and a passage you cannot hear is marked [inaudible] — never guessed from context, however obvious the guess feels.',
        'Submit one file per call plus a list of the timestamps you flagged. Payment is per completed call; a call with a reconstructed passage is returned, not paid.',
      ),
      assessmentQuestions: transcriptionQuestions(region),
      requiresVerified: true,
      status: 'open',
      closesAt,
      postedAgo: '3 days ago',
    },
    {
      id: regionalJobId(region, 'shelf-labels'),
      title: `Label ${JOB_REGION_LABELS[region]} retail shelf photos for a planogram audit`,
      category: 'Image Labeling',
      region,
      description: `Draw a box around every price tag and product face in 400 shelf photographs from ${JOB_REGION_LABELS[region]} stores, then classify each tag as matching the product above it. Two reviewers grade the same photos, and a disagreement is re-checked before it is paid.`,
      responsibilities: [
        'Box every price tag and product face in 400 photos',
        'Mark each tag as matching, mismatched or unreadable against the product above it',
        'Leave glare and cropped tags in a separate class rather than guessing the number',
      ],
      payAmountUsd: pay.labels,
      estimatedMinutes: 220,
      capacity: 30,
      slotsRemaining: 24,
      trainingRequired: true,
      trainingFeeUsd: fee,
      trainingNotes: sections(
        region,
        `The audit answers one question for the ${JOB_REGION_LABELS[region]} retailer: is the shelf telling the truth? A tag that is boxed but misclassified is worse than one left unlabelled, because the client acts on it. ${MARKET_DETAIL[region].shelf} is the case this queue is built around.`,
        `Two habits decide your score. Box the tag itself, not the shelf edge — a box that includes the rail cannot be re-read by the classifier. And judge the class, not the product: ${MARKET_DETAIL[region].labelRules}.`,
        'Submit the label file in the supplied format plus your disagreement list. QA re-checks a sample against the photo, so a guessed class is caught even when it looks plausible.',
      ),
      assessmentQuestions: labelQuestions(region),
      requiresVerified: true,
      status: 'open',
      closesAt,
      postedAgo: '5 days ago',
    },
    {
      id: regionalJobId(region, 'support-translation'),
      title: `Translate ${JOB_REGION_LABELS[region]} customer support replies`,
      category: 'Translation',
      region,
      description: `Translate 150 support replies between ${MARKET_DETAIL[region].pair} for a business operating in ${JOB_REGION_LABELS[region]}. Every reply carries a refund amount, a delivery date or a policy sentence, and all three have to survive translation exactly.`,
      responsibilities: [
        'Translate 150 replies, keeping amounts, dates and policy wording exact',
        'Flag any reply whose meaning depends on a local term with no clean equivalent',
        'Leave a glossary entry for every recurring term you had to decide once',
      ],
      payAmountUsd: pay.translation,
      estimatedMinutes: 210,
      capacity: 25,
      slotsRemaining: 21,
      trainingRequired: true,
      trainingFeeUsd: fee,
      trainingNotes: sections(
        region,
        `These replies go straight to customers in ${JOB_REGION_LABELS[region]}, so a mistranslated refund amount is a real dispute. The pair is ${MARKET_DETAIL[region].pair}; the register is polite and plain, and the customer is often already angry.`,
        `Translate meaning, not words, except where the words are the commitment. A policy sentence is translated as written even when it reads badly — you are not improving the client's terms. ${MARKET_DETAIL[region].residency} is the sort of question that arrives in these threads, and the answer must not be softened.`,
        'Submit the translated replies and your glossary. Payment is per completed reply; a reply where an amount or date changed is returned regardless of how good the prose was.',
      ),
      assessmentQuestions: translationQuestions(region),
      requiresVerified: true,
      status: 'open',
      closesAt,
      postedAgo: '6 days ago',
    },
  ]
}

const JOB_REGION_LABELS: Record<JobRegion, string> = {
  Africa: 'African',
  Americas: 'Americas',
  Europe: 'European',
  Asia: 'Asian',
}

// ─── Assessments ────────────────────────────────────────────────────────────
//
// Twenty questions per card, applied rather than definitional: each one gives a rule, a messy source
// and a tempting shortcut. The pass mark is 80%, and the review is returned after scoring, so the
// assessment teaches instead of only filtering. The region is named in the prompts because the
// failure modes are regional — a currency column, a promo condition, a local regulatory rule.

/** The pattern for every bank below: a rule, a source, a shortcut that looks reasonable. */
function q(
  question: string,
  options: [string, string, string, string],
  correctIndex: 0 | 1 | 2 | 3,
  explanation: string,
): AssessmentQuestion {
  return { question, options: [...options], correctIndex, explanation }
}

function invoiceQuestions(region: JobRegion): AssessmentQuestion[] {
  const currency = region === 'Africa' ? 'KSh' : region === 'Americas' ? 'USD' : region === 'Europe' ? 'EUR' : 'the local currency'
  return [
    q(`The brief says dates are written DD/MM/YYYY and must become ISO 8601. A row reads 05/03/2026. What goes in the date column?`, ['2026-05-03', '2026-03-05', 'Leave 05/03/2026', 'Ask the client for the format'], 1, 'DD/MM/YYYY means the fifth of March. Converting format is not re-interpreting day and month.'),
    q(`Two rows share supplier, invoice number, date and total. Their descriptions differ by "- revised". The brief defines a duplicate as supplier + invoice number + date + total. What do you do?`, ['Delete the revised row', 'Merge them into one row', 'Keep both and flag the duplicate', 'Change one total so they no longer match'], 2, 'The key matches, so it is a suspected duplicate — but the brief says a description difference does not settle it. Flag, do not decide.'),
    q(`An invoice total reads ${currency} 1,240 but the subtotal plus tax reads ${currency} 1,204. The brief says never alter a source figure. What is correct?`, ['Enter 1,204 because the arithmetic is right', 'Enter 1,240 and flag the mismatch', 'Enter the average of the two', 'Skip the row entirely'], 1, 'You transcribe what the paper says and report the discrepancy. Correcting it silently removes the only evidence the bookkeeper had.'),
    q(`A scanned invoice is rotated 90 degrees and the top line is cut off, so the invoice number is unreadable. What belongs in that cell?`, ['Your best guess at the number', 'The date of the invoice instead', 'Empty, with a note that it is unreadable', 'The supplier name repeated'], 2, 'An invented key destroys the ability to match the invoice later. Empty plus a note is the honest record.'),
    q(`The template asks for two decimal places. A row reads ${currency} 89.5. What do you enter?`, ['89.5', '89.50', '90', '89.500'], 1, 'Two decimals means two decimals. 89.50 is the same value written to the required shape.'),
    q(`A supplier sends the same invoice number twice in different months, with identical amounts. The brief says invoice numbers are unique per supplier per month. What is this?`, ['A duplicate, delete one', 'Two legitimate invoices', 'A duplicate to flag and keep both', 'An error in the template'], 1, 'Per-month uniqueness means the same number in a different month is a different invoice. Deleting one removes real money.'),
    q(`The brief says discount columns are informational and must not reduce the total column. A row has a 10% discount and a total that already reflects it. What do you enter for total?`, ['The total as printed', 'The total plus the discount back', 'The total minus the discount again', 'Blank, because the total is ambiguous'], 0, 'Transcribe what is printed. The brief told you where the discount lives; recalculating overrides the source.'),
    q(`A handwritten note in the margin reads "paid 12/3". The template has no paid column. What do you do?`, ['Add a column for it', 'Ignore it — there is no column', 'Note it in the flags list', 'Write it in the supplier cell'], 2, 'Do not change the schema, and do not throw away information the client may need. Flag it.'),
    q(`Three rows have the same supplier and the same total but different invoice numbers. What do you conclude?`, ['It is a duplicate keyed on total', 'They are separate invoices', 'One of the numbers is wrong', 'The supplier is double-billing'], 1, 'The duplicate key includes the invoice number. Different numbers are different invoices until someone proves otherwise.'),
    q(`The brief requires the client's own currency in a currency column and the amount in the amount column. A row is priced in a foreign currency. What do you enter in amount?`, ['The converted amount', 'The foreign amount, with the currency column stating it', 'The converted amount in both', 'Blank'], 1, 'The sheet has a currency column for exactly this. Converting silently destroys the source value.'),
    q(`A row's supplier name is misspelt compared with the other eleven rows from the same supplier. What is correct?`, ['Correct it to match the others', 'Enter it as written and flag it', 'Leave it and say nothing', 'Merge the two supplier names'], 1, 'You are not the authority on the supplier name. Transcribe and flag.'),
    q(`The template's date column rejects text. A row's date is illegible beyond the month. What goes in?`, ['The first of that month', 'Empty with a flag', 'The month and year only as text', 'The date you started'], 1, 'A plausible date is worse than a gap: it will be treated as real.'),
    q(`The brief says all amounts are net of tax unless a tax column is present. A row has a tax column with 0. What does the total mean?`, ['Tax-exempt', 'Tax included at 0%', 'Ambiguous — flag it', 'Zero value invoice'], 2, 'A zero tax column can mean exempt, zero-rated or unfilled. The brief does not settle it, so it is a flag.'),
    q(`You finish 58 of 60 invoices and two scans will not open. What is the correct submission?`, ['Submit 58 and do not mention it', 'Submit 58 with a note naming the two that failed', 'Submit 60 with placeholders', 'Do not submit until all 60 open'], 1, 'A complete handover names its gaps. Placeholders would be invented data; silence would hide it.'),
    q(`A row's total is ${currency} 0.00 for a non-zero subtotal. The brief has no rule for this. What do you do?`, ['Enter 0.00 as printed', 'Enter the subtotal', 'Flag it; enter as printed', 'Delete the row'], 2, 'Both the transcription and the flag matter: the number is what the paper says, the flag is what the client needs.'),
    q(`The client asks mid-batch for a new column. The brief is the authority for this batch. What do you do?`, ['Add the column', 'Finish per the brief and raise it in the handover note', 'Stop work and wait', 'Add it for future rows only'], 1, 'Scope changes belong in the handover, not silently inside a deliverable that will be reconciled against a template.'),
    q(`Two rows look identical but one date reads 03/04/2026 and the other reads 04/03/2026. DD/MM/YYYY is stated. What are these?`, ['The same invoice duplicated', 'Two different invoices', 'One of them has a typo', 'Ambiguous — both are valid'], 1, 'In DD/MM/YYYY those are 3 April and 4 March: different dates, therefore different keys.'),
    q(`A supplier's invoice lists a subtotal, a tax line and a total where total = subtotal + tax. The template asks for all three. What do you enter for total?`, ['The printed total', 'Subtotal plus tax, recalculated', 'Subtotal only', 'Blank, since it is derived'], 0, 'Even when the arithmetic is checkable, the printed figure is the record. Recalculation hides printing errors.'),
    q(`The brief says flag anything you are unsure about, and QA penalises both invented data and missing flags. You are unsure about one date format on one row. What is the right call?`, ['Enter your best guess without a flag', 'Enter as written and flag the uncertainty', 'Skip the row', 'Email the client directly'], 1, 'The flag is the audit trail. Invented certainty is the failure mode the brief is written against.'),
    q(`You have finished the sheet. Which of these makes it defensible in a QA review?`, ['Every cell filled, no blanks', 'Every blank explained in the flags list', 'Perfect formatting', 'Fastest completion time'], 1, 'Completeness is not "no gaps" — it is "no unexplained gaps".'),
  ]
}

function reviewQuestions(region: JobRegion): AssessmentQuestion[] {
  const market = JOB_REGION_LABELS[region]
  return [
    q(`The policy sheet has nine numbered rules. A listing breaches none of them but you find it distasteful. What is correct?`, ['Remove it with rule 0 as the reason', 'Leave it — policy is the standard, not taste', 'Escalate it as a removal', 'Ask the client to decide before you continue'], 1, `Personal judgement is not a rule. Removing listings outside policy costs the ${market} client sales and is itself a QA failure.`),
    q(`A listing claims a supplement "cures" a condition. The policy prohibits disease claims. What is the reason code?`, ['The rule number for disease claims', 'A free-text explanation of the cure claim', 'Counterfeit', 'No removal — it is a supplement'], 0, 'Reason codes are rule numbers so the client can measure which rule is being broken. Free text does not aggregate.'),
    q(`A listing is priced 90% below every other listing of the same branded item. No rule names pricing. What do you do?`, ['Remove for counterfeit', 'Escalate as a possible counterfeit', 'Leave it; price is not a rule', 'Remove and note the price'], 1, 'It is a signal, not a breach. Escalation exists for exactly this: a decision above your authority.'),
    q(`Two listings from the same seller are identical. The policy does not address duplicate listings. What is correct?`, ['Remove one', 'Leave both and note it', 'Remove both', 'Escalate as policy breach'], 1, 'Not a rule, not a counterfeit signal. Note it and move on without inventing policy.'),
    q(`A health product lists the permitted claim word for word and also shows a doctor's photograph with a testimonial. The policy prohibits testimonials in that category. What is the reason code?`, ['The testimonial rule', 'The disease-claim rule', 'Both rules', 'None — the claim is compliant'], 0, 'The claim is compliant; the testimonial is not. Code the actual breach.'),
    q(`A listing's title contains a competitor's brand name. The policy prohibits brand misuse. The item itself is unbranded. What do you do?`, ['Remove using the brand-misuse rule', 'Leave it — the item is unbranded', 'Escalate', 'Rename the listing'], 1, 'You cannot edit a listing. If the title misuses a brand, that is the brand-misuse rule, not a free pass.'),
    q(`You are unsure whether a knife is a prohibited weapon or a kitchen item. The policy lists both with examples. What is correct?`, ['Remove — weapons are prohibited', 'Leave — kitchen items are allowed', 'Check the examples against the listing, escalate if still unclear', 'Flip a coin but log it'], 2, 'The policy carries examples precisely so a judgement call can be made from the text. Escalate only what the text does not reach.'),
    q(`A listing you removed is appealed with a screenshot showing it complies. What do you do?`, ['Reinstate it', 'Leave it removed; appeals go to the client', 'Remove it again to be safe', 'Ask the seller to resubmit'], 1, 'The reviewer does not litigate appeals. Reinstate on appeal and the queue becomes negotiable.'),
    q(`The policy says "Genuine" badges require a manufacturer invoice. A listing shows a badge and a photo of a receipt. What is correct?`, ['Leave it — the receipt is evidence', 'Escalate: the evidence is not the required document', 'Remove it for counterfeit', 'Remove the badge only'], 1, 'A receipt is not a manufacturer invoice. The listing is not proven counterfeit, so escalate rather than remove.'),
    q(`A listing is in a language you do not read. What is the correct action?`, ['Skip it silently', 'Use machine translation and decide', 'Escalate to a reviewer who reads it', 'Remove it for review failure'], 2, 'Deciding from a translation you cannot check is how a compliant listing gets removed.'),
    q(`The client's nine rules conflict on one listing: rule 3 permits what rule 7 prohibits. What is correct?`, ['Apply rule 3', 'Apply rule 7', 'Escalate the conflict', 'Remove and cite both'], 2, `A conflict in the ${market} policy is a client question, not a reviewer's call. Escalate it and note it for the sheet's owner.`),
    q(`You remove 40 of 120 listings and every removal cites the same rule. What should you check before submitting?`, ['Nothing — consistency is good', 'Whether the rule genuinely covers that many listings', 'Whether you should remove more', 'Whether the rule number is right'], 1, 'A single rule accounting for a third of the queue is more often a misread rule than a bad catalogue.'),
    q(`A listing is compliant but the seller's store page contains a prohibited claim. The policy governs listings. What do you do?`, ['Remove the listing', 'Leave the listing and escalate the store', 'Remove the store', 'Note it on the listing without action'], 1, 'Scope matters: the listing is compliant, the store is a different object and above your authority.'),
    q(`The policy requires a reason on every removal and QA samples reasons against listings. Yours reads "violates policy". What is wrong with it?`, ['Nothing, if the rule is cited elsewhere', 'It does not name the rule or the evidence', 'It is too short to read', 'Nothing — QA only checks the listing'], 1, 'A reason that could apply to anything cannot be audited, which is the same as having none.'),
    q(`A listing shows a price in a currency the marketplace does not support. No rule covers it. What is correct?`, ['Remove it', 'Leave it and note it', 'Escalate as a policy gap', 'Convert the price'], 1, 'Not a listed breach. Note it; the client decides whether to add a rule.'),
    q(`You find two listings that breach rule 5 and one that breaches rules 5 and 8. How many reason codes does the third need?`, ['One, the more serious', 'Two, one per rule', 'None until the first is resolved', 'One combined code'], 1, 'Each breach is its own code, or the client cannot count rule 8 breaches.'),
    q(`A seller's listing uses a photo that appears on another seller's listing. Which is the correct first step?`, ['Remove both', 'Escalate the image duplication', 'Remove the newer listing', 'Ask the seller'], 1, 'Image reuse is a signal of several different problems; it is escalated, not adjudicated at this level.'),
    q(`The policy prohibits "miracle" claims. A listing says "clinically proven". What is correct?`, ['Remove — it is a health claim', 'Check the policy text for whether that phrase is covered', 'Leave it — it is not the word miracle', 'Escalate automatically'], 1, 'Apply the written rule to the actual phrase. A keyword match is not a review.'),
    q(`Your queue has 120 listings and you have removed 4. The client asks why the removal rate is low. What is the honest answer?`, ['The queue was mostly compliant', 'You were being cautious', 'The policy is unclear', 'You ran out of time'], 0, 'A low removal rate is a finding, not an apology. Inflating it to look productive is the failure the QA sample is designed to catch.'),
    q(`Which submission makes your review auditable?`, ['A count of removals per rule', 'A list of listing ids with rule codes and evidence notes', 'A summary paragraph', 'A screenshot of the queue'], 1, 'The sample is checked listing by listing; only per-listing evidence survives that.'),
  ]
}

function researchQuestions(region: JobRegion): AssessmentQuestion[] {
  const market = JOB_REGION_LABELS[region]
  const currency = region === 'Africa' ? 'KSh' : region === 'Americas' ? 'USD' : region === 'Europe' ? 'EUR' : 'local currency'
  return [
    q(`The brief asks for shelf price and promo price in separate columns. A retailer shows ${currency} 450 with "members only". What goes in the promo column?`, ['450', '450, with the condition in notes', '0, since it is unavailable to you', 'Blank'], 1, `A promo price without its condition is a wrong number — a ${market} client would price against a number most customers cannot get.`),
    q(`A price is quoted in a currency other than the one the sheet uses. What is correct?`, ['Convert it at the current rate', 'Record the amount and its currency in the currency column', 'Skip the retailer', 'Convert and note the rate'], 1, 'Silent conversion destroys the source and makes the sheet unauditable.'),
    q(`You cannot find a price for one of the four products at a named retailer. What belongs in the cell?`, ['An estimate from a similar retailer', 'Blank, marked unavailable', 'The nearest competitor price', '0'], 1, 'A price you did not see will be trusted as if you had. Blank plus a reason is the honest record.'),
    q(`The brief requires the date each price was checked. You checked three products today and one yesterday. What do you record?`, ['Today for all four', 'Per-row dates', 'The batch start date', 'No dates; the sheet has a header'], 1, 'Prices move. A single date for a batch that spans days misrepresents three rows.'),
    q(`A retailer lists a price with a strikethrough and a lower current price. Which is the shelf price?`, ['The struck-through price', 'The current price', 'Both in the shelf column', 'The average'], 1, 'Shelf price means what a customer pays today; the struck-through figure is a marketing claim, not a price.'),
    q(`A product is out of stock everywhere. The brief says record prices for listed products. What do you do?`, ['Record the last known price', 'Mark unavailable with the date checked', 'Leave the retailer out', 'Record 0'], 1, 'Out of stock is information. A stale price presented as current is not.'),
    q(`The client will set their launch price from this sheet. One price you recorded looks implausible — half the others. What is correct?`, ['Drop the outlier', 'Re-check the page and record what you find', 'Adjust it to match the others', 'Keep it and say nothing'], 1, 'Re-checking is the only honest way to resolve an outlier. Editing it invents data.'),
    q(`A retailer's price differs between the search result and the product page. Which do you record?`, ['The search result', 'The product page', 'Both', 'The lower one'], 1, 'The product page is the page a buyer pays on; the search result is a cached summary.'),
    q(`The brief asks for 80 price points. You found 78 and two are genuinely unavailable. What is the submission?`, ['78 rows, no comment', '80 rows including two marked unavailable', '78 rows with an explanation', 'Wait for the prices to return'], 1, 'The brief asked for the comparison across 20 retailers; an explicit unavailable is a result, a missing row is a hole.'),
    q(`Which of these belongs in the notes column?`, ['"Cheapest in market"', '"Members only, minimum spend 2,000"', '"Probably a promo"', '"Looks wrong"'], 1, 'Notes carry conditions and evidence. Opinions and hedges do not help a client decide.'),
    q(`A retailer's site blocks automated access and asks you to email for a price. What do you do?`, ['Scrape anyway', 'Record unavailable and note the email-only policy', 'Estimate from another market', 'Skip and say nothing'], 1, 'Recording why is what stops the next person repeating the same dead end.'),
    q(`The sheet has a currency column and the brief names ${currency} as the sheet currency. A price is in a different currency. What is correct?`, ['Convert into ${currency}'.replace('${currency}', currency), 'Record the original and its currency', 'Leave blank', 'Record in both columns'], 1, 'The column exists so this is representable without converting.'),
    q(`A price changed between your first and second visit in the same session. What do you record?`, ['The first', 'The second, with the time', 'Both with times', 'The average'], 1, 'The later figure is what is live; noting the time is what makes it checkable.'),
    q(`The brief says prices are per unit. A listing shows a multipack price. What is correct?`, ['Record the multipack price', 'Record per unit, noting the pack', 'Skip the listing', 'Record both without a note'], 1, 'Comparing a pack price with a unit price is how a launch price gets set wrong.'),
    q(`Two retailers are the same chain with different store pages. What is correct?`, ['Treat them as one retailer', 'Record both as separate rows and note the relationship', 'Pick the cheaper', 'Skip one'], 1, 'The brief named 20 retailers; collapsing two changes the sample without permission.'),
    q(`You are asked to include a fifth product the brief does not mention. What do you do?`, ['Add it — more data is better', 'Record the four named, raise the fifth in the handover', 'Add it and remove the least useful one', 'Ask nothing and skip it'], 1, `Scope belongs to the brief. Extra rows make the ${market} sheet harder to reconcile, not more valuable.`),
    q(`A price is shown only after adding to a basket. Is it a shelf price?`, ['Yes, it is the real price', 'No — record unavailable and note the basket requirement', 'Yes, but with a note', 'Record the pre-basket price'], 1, 'The brief asked for the shelf price; a basket-only price is a different measurement, and saying so is the finding.'),
    q(`Which of these makes a price point defensible later?`, ['A screenshot', 'The URL and the date checked', "The retailer name", 'A note saying "checked"'], 1, 'A URL plus a date can be re-checked by anyone. That is what defensibility means here.'),
    q(`The client asks whether the sheet is complete. You missed one retailer entirely. What is the honest answer?`, ['Yes, complete', 'No — one retailer is missing', 'Yes, with minor gaps', 'It is complete enough'], 1, 'A deliverable that overstates its own completeness is the one failure a client cannot detect.'),
    q(`Research pay is per completed sheet. Two retailers were closed for renovation. When is the sheet complete?`, ['When every cell has a number', 'When every cell is filled or explicitly marked unavailable with a reason', 'When 90% is filled', 'When the client stops asking'], 1, 'Completeness is explained gaps, not full cells.'),
  ]
}

function transcriptionQuestions(region: JobRegion): AssessmentQuestion[] {
  const market = JOB_REGION_LABELS[region]
  const money = MARKET_DETAIL[region].money
  return [
    q(`A caller says "nimetuma elfu mbili" and the agent repeats "two thousand". Which goes in the transcript?`, ['Only the English repeat', 'Both utterances, as spoken, in their speaker turns', 'The Swahili translated into English', 'The figure, once, in the notes column'], 1, 'A transcript is a record of what was said. Collapsing two utterances into one destroys the evidence that the agent confirmed the amount.'),
    q(`A customer spells a name letter by letter and the letters are hard to hear. What is correct?`, ['Write the most likely name from context', 'Write the letters you heard and mark the rest [inaudible]', 'Omit the spelling entirely', 'Substitute a similar-sounding name'], 1, 'A reconstructed name is invented evidence. Partial transcription plus a flag is the honest record.'),
    q(`The audio has two people talking over each other for six seconds. What do you do?`, ['Transcribe whoever is louder', 'Mark the overlap and transcribe what is distinguishable', 'Skip the six seconds silently', 'Guess the exchange from what follows'], 1, 'Overlap is a fact about the call. Marking it lets QA re-listen; skipping it hides a gap in the record.'),
    q(`An amount is spoken as "twelve hundred" but the client asks for digits in the notes column. What goes in the transcript body?`, ['1200', 'Twelve hundred, with 1200 in the notes column', 'Both, inline as 1200 (twelve hundred)', 'Whatever reads better'], 1, 'Verbatim body, normalised digits in the notes column. That is the convention the brief sets, and it keeps both the words and the number findable.'),
    q(`The brief requires a timestamp every thirty seconds. A sentence begins at 29 seconds and ends at 34. Where does the timestamp go?`, ['At the start of the sentence', 'At the thirty-second mark inside it', 'At the end of the sentence', 'Nowhere; it spans a boundary'], 1, 'The marker belongs where the clock says it is, inside the sentence, so a reviewer can seek to it. Moving it to a sentence edge breaks the seek.'),
    q(`A caller gives a phone number twice and the two readings differ by one digit. What is correct?`, ['Use the second, as it is a correction', 'Transcribe both and flag the discrepancy', 'Use the first reading', 'Ask the client which is right'], 1, 'You are not adjudicating. Both readings are evidence; the flag is what the client needs.'),
    q(`Background noise makes four words unintelligible but the meaning is obvious from the rest. What do you write?`, ['The likely words', 'A paraphrase in brackets', '[inaudible] for those words', 'Nothing, and continue the sentence'], 2, 'Obvious to you is not evidence. [inaudible] marks exactly what the recording did not carry.'),
    q(`The agent quotes a policy sentence from a script. The caller repeats it slightly wrong and the agent does not correct them. What do you transcribe?`, ['The script version, for accuracy', 'What each speaker actually said', 'The caller version only', 'A merged version'], 1, 'The disagreement between script and customer belief is often the whole dispute. Smoothing it removes the finding.'),
    q(`A stretch of the call is hold music for two minutes. What belongs in the transcript?`, ['Nothing for that stretch', 'A marked hold segment with start and end', 'A guess at what happened', 'A note that the call was paused'], 1, 'A two-minute gap with no marker looks like a transcription failure. Mark it as hold, with the timestamps.'),
    q(`The client asks for "clean readable transcripts". The brief also says verbatim. Which wins?`, ['Clean readable', 'Verbatim, with punctuation you may tidy', 'A summary plus verbatim appendix', 'Ask the client'], 1, 'The brief is the authority: verbatim content, punctuation you may tidy. Cleaning grammar changes what was said.'),
    q(`A caller reads out an account number with pauses: 4-4-2-1-9. What do you transcribe?`, ['442 19', 'As spoken, with the pauses marked', '44219 in digits only', 'The number, spelled out'], 1, 'The grouping is how the number was given, and a mis-grouped number is a mis-transcribed number.'),
    q(`Two speakers have the same first name. What is the correct labelling?`, ['Both as "Speaker"', 'Speaker 1 and Speaker 2, with a note if the call establishes who is who', 'The agent as "Agent" and the caller by name', 'Their full names from the CRM'], 1, 'Labels must be stable and derived from the audio. Pulling names from elsewhere invents information the recording does not contain.'),
    q(`A caller is upset and swears repeatedly. The client template has no profanity guidance. What do you do?`, ['Censor the words', 'Transcribe verbatim and note it in the flags list', 'Omit the words', 'Replace with asterisks'], 1, 'Censoring edits evidence. Transcribe, then flag so the client can set a house rule.'),
    q(`A caller states an amount in words and the agent confirms it in digits, and the two do not match. What is the risk of transcribing only the digits?`, ['None; the number is the same', 'The words are the customer claim and the digits are the agent restatement — they can differ', 'The digit form is easier to search', 'The words are redundant'], 1, 'Two speakers, two utterances. Transcribing one loses the chance to catch a disagreement about the amount.'),
    q(`A call cuts off mid-sentence at 3:12. What do you record?`, ['The transcript ends at 3:12 with a note that the recording ended', 'A guessed completion of the sentence', 'The call as complete', 'Nothing after the last full sentence'], 0, 'An abrupt end is a fact. Noting it stops QA reading a truncated transcript as a sloppy one.'),
    q(`You finish nine of ten calls and one file will not open. What is the correct submission?`, ['Nine calls, no mention', 'Nine calls plus a note naming the file that failed', 'Ten, with the tenth empty', 'Nothing until all ten open'], 1, 'A handover that names its gap is complete. An empty file would look like a call with no speech.'),
    q(`The audio contains a language the brief did not name, mixed with English. What is correct?`, ['Transcribe the English and mark the rest as a foreign-language passage', 'Skip the call', 'Translate the other language', 'Transcribe phonetically'], 0, 'Marking the language boundary is accurate. Skipping loses the call; translating invents a step the brief did not ask for.'),
    q(`A caller gives a date as "the third of next month". What goes in the transcript?`, ['The computed date', 'The words, as spoken', 'A numeric date', 'The words plus a computed date in the notes'], 1, 'Verbatim first. Computing a date is an interpretation, and "next month" depends on when the call was placed.'),
    q(`QA checks one call at random against its audio. Which habit protects you?`, ['Fast typing', 'Consistent conventions applied to every call', 'Polished prose', 'Transcribing from memory afterwards'], 1, 'A sample catches an inconsistent convention because it appears everywhere. Clean prose that drops a word is still a dropped word.'),
    q(`Which of these makes a transcript defensible in a dispute?`, ['No gaps at all', 'Every gap marked and every ambiguity flagged as it occurs', 'Perfect spelling', 'A summary at the top'], 1, 'Defensibility is explained gaps. That is the whole of the standard on this queue.'),
  ]
}

function labelQuestions(region: JobRegion): AssessmentQuestion[] {
  const market = JOB_REGION_LABELS[region]
  const rules = MARKET_DETAIL[region].labelRules
  return [
    q(`A price tag is boxed but half of it is behind the shelf rail, so the number cannot be read. What class is correct?`, ['Matching', 'Mismatched', 'Unreadable', 'Leave it unboxed'], 2, 'An unreadable tag is its own class so the client can count them. Filing it as matching invents a number nobody could see.'),
    q(`The box around a tag includes the shelf rail and the neighbouring tag. What is wrong with it?`, ['Nothing; the tag is inside', 'The box must contain only the tag being classified', 'The box is too small', 'The box should include the product'], 1, 'A box that contains two tags cannot be classified against one product, and the classifier is trained on the box.'),
    q(`Two products share one price tag on the shelf. What is the correct label?`, ['Matching', 'Mismatched', 'One box per product, both referencing the same tag id', 'Leave the products unboxed'], 2, 'The shelf is doing something unusual and both products need that fact attached. Dropping one product loses it.'),
    q(`A tag shows a promo price with a struck-through original. The till price matches the promo. Is the tag matching?`, ['No — two prices on one tag', 'Yes — the current price is what the shopper pays', 'Only if the promo has an end date', 'Unreadable'], 1, 'The question is what the shopper pays today. A struck-through figure is a marketing claim, not the price.'),
    q(`A product face is turned away so the brand cannot be read, but the barcode is visible. How do you label it?`, ['Box the barcode as the product face', 'Box the product and mark the face as obscured', 'Skip the product', 'Infer the brand from the shelf position'], 1, 'The product exists and is obscured. Inferring a brand from position is a guess dressed as data.'),
    q(`The photo is taken at an angle so the tag for row 3 sits visually under row 4's product. Which product does the tag belong to?`, ['The product it visually sits under', 'The product in its own row, from the shelf edge alignment', 'Split the difference', 'Mark as ambiguous'], 1, 'Planogram audits are about rows. Perspective is a camera artefact, and the shelf edge is the reliable alignment.'),
    q(`The brief says ${rules}. A pack photo shows the mark but it is a sticker applied over the printed area. What is correct?`, ['Approve — the mark is visible', 'Mark it for review: the mark is not part of the printed label', 'Reject outright', 'Ignore the mark'], 1, 'Visible but not printed is a real distinction in these audits, and it is a review item rather than a rejection you are not authorised to make.'),
    q(`A shelf tag reads a price that is 10x the neighbouring tags for the same product. Suspecting a typo, what do you do?`, ['Label it matching', 'Label it mismatched and flag the magnitude', 'Correct the price in the label', 'Skip the tag'], 1, 'You report what the shelf says. Correcting the number in the label destroys the only record of what was printed.'),
    q(`Glare covers the last two digits of a price. Which class?`, ['Matching, if the rest matches', 'Unreadable', 'Mismatched', 'Matching with a note'], 1, 'If the number cannot be read the tag is unreadable, and the note field is not a substitute for the class.'),
    q(`A product appears twice in one photo because it is stocked in two facings. What is correct?`, ['One box, two facings noted', 'Two boxes, one per facing', 'One box per SKU regardless of facings', 'Box only the front facing'], 1, 'The audit counts facings, which is why each is its own box. Collapsing them undercounts the shelf.'),
    q(`The tag is legible but the product above it is entirely missing from the shelf. What do you do?`, ['Label the tag unreadable', 'Label the tag as a gap and note the missing product', 'Leave both unboxed', 'Box the empty space as a product'], 1, 'An out-of-stock is exactly what a planogram audit wants to find. Marking the tag unreadable buries the finding.'),
    q(`Your box edges are consistently 5 pixels inside the tag. Does it matter?`, ['No, the tag is still inside', 'Yes — the box must cover the tag, not most of it', 'Only for large tags', 'Only if the number is cut'], 1, 'A cropped box loses the edge of the number for the classifier. Consistency is not the same as correctness.'),
    q(`A competitor product is stocked in the client's slot with no tag. What is correct?`, ['Box it as a mismatched product', 'Box it and note it as a foreign product in the slot', 'Ignore it', 'Box the empty tag slot'], 1, 'It is a finding the client wants, and it is not a tag mismatch because there is no tag. The class has to say what it actually is.'),
    q(`One photo is too dark to classify anything. What is the right submission for that photo?`, ['Skip it silently', 'Mark the photo unusable and note why', 'Classify everything unreadable', 'Guess the classes from the shelf pattern'], 1, 'The unit of work includes photo quality. Marking the whole photo unusable is accurate and countable; guessing is not.'),
    q(`The client's slot label on the shelf edge is in a language you do not read. What do you do?`, ['Skip the row', 'Use the position and the barcode, and note the language', 'Guess from the packaging colour', 'Mark the row unreadable'], 1, 'The audit keys on position and barcode. Noting the language is useful; guessing from colour is not evidence.'),
    q(`A price tag shows a currency symbol the client's brief does not mention. What is correct?`, ['Convert it', 'Record the tag as printed and flag the currency', 'Mark mismatched', 'Mark unreadable'], 1, 'The tag is legible and it is what it is. Flagging the currency tells the client their brief is out of date.'),
    q(`Two reviewers disagree on one product's class. What should happen for your part?`, ['You change yours to agree', 'Both classes stand and the item is re-checked', 'The senior reviewer wins', 'The product is dropped'], 1, 'The disagreement is the signal the process is built to find. Quietly agreeing removes it.'),
    q(`The brief asks for boxes on every price tag. A shelf has a handwritten tag next to a printed one. What is correct?`, ['Only the printed tag', 'Both tags, each boxed', 'Only the handwritten one', 'Neither, since they conflict'], 1, 'A handwritten tag over a printed one is the exact case the audit is looking for. Both are tags.'),
    q(`You finish 380 of 400 photos. What is the correct submission?`, ['380, no mention', '380 plus a list of the 20 that are not done', '400 with the missing 20 empty', 'Hold everything until 400'], 1, 'Completeness is explained gaps. An empty photo entry reads as a photo with nothing in it.'),
    q(`Which submission makes an image-label job auditable?`, ['Fast throughput', 'A label file in the required format plus your disagreement and exception list', 'A summary of the overall condition', 'Screenshots of your work'], 1, 'QA re-checks the file against the photos. Only the structured file plus exceptions survives that.'),
  ]
}

function translationQuestions(region: JobRegion): AssessmentQuestion[] {
  const market = JOB_REGION_LABELS[region]
  const pair = MARKET_DETAIL[region].pair
  const residency = MARKET_DETAIL[region].residency
  const amount = region === 'Africa' ? 'KSh 1,240' : region === 'Americas' ? '$48.00' : region === 'Europe' ? 'EUR 42.00' : 'the local amount'
  return [
    q(`A reply says "your refund of ${amount} will arrive within 5 working days". A translator renders "within about a week". What is wrong?`, ['Nothing; the meaning is close', 'Both the amount and the committed number of days changed', 'Working days should be calendar days', 'The tone is too formal'], 1, 'The two things a customer can hold the business to are the amount and the deadline. Both were altered.'),
    q(`A policy sentence is awkward in the target language. What is correct?`, ['Rewrite it so it reads naturally', 'Translate it as written, however awkward', 'Soften it to be polite', 'Omit it and explain in a note'], 1, 'You are not the author of the client terms. Clarity of your translation is your job; changing their commitment is not.'),
    q(`A local term has no clean equivalent in the target language. What belongs in the glossary entry?`, ['The nearest English word', 'The term, the chosen rendering, and one line on what is lost', 'A footnote in every reply', 'The term untranslated with no explanation'], 1, 'The glossary is what keeps 150 replies consistent. Recording what is lost is how the next translator avoids guessing differently.'),
    q(`The customer writes in the source language and the agent replies in it too, mixing ${pair}. What do you translate?`, ['Only one direction', 'Both, keeping the register each speaker used', 'Only the customer messages', 'Neither — leave it as written'], 1, `The deliverable is a reply the customer can act on. Dropping one side breaks the exchange; the pair is ${pair}, so both directions are in scope.`),
    q(`A reply contains a legal reference the target reader will not recognise. What do you do?`, ['Replace it with the equivalent local law', 'Keep the reference and add a translator note', 'Delete the reference', 'Translate it loosely'], 1, 'Substituting a different jurisdiction changes the client obligation. A note tells the reader what they are looking at without editing the claim.'),
    q(`The source says "approximately". You know the client's system is exact to two decimals. What do you translate?`, ['The exact figure', '"Approximately", as written', 'Nothing — ask the client', '"Up to" the figure'], 1, 'Your knowledge of the system is not in the source. Translating what is written is the only defensible choice.'),
    q(`A customer is angry and uses strong language. The template says replies are polite. What do you do with their message?`, ['Soften it', 'Translate it as written and keep the reply polite', 'Omit the strong words', 'Translate only the reply'], 1, 'The customer register is part of the record; the reply register is the client policy. They are separate decisions.'),
    q(`Two replies use the same source sentence but different contexts. Must they be translated identically?`, ['Yes, always', 'Not necessarily — the rendering must fit the context, and the glossary records both', 'No, the translator decides freely', 'Only if the sentence is a policy'], 1, 'Consistency is about decisions, not identical strings. Recording both renderings is what keeps the file auditable.'),
    q(`A date is written as 03/04 in the source. The target audience reads month first. What is correct?`, ['Translate to the target numeric convention', 'Keep it ambiguous', 'Render it as an unambiguous date and note the source format', 'Use the source convention'], 2, 'Ordering swaps are how refunds arrive a month late. Making the date unambiguous is the translation, not an embellishment.'),
    q(`A reply contains the client's registered company name. What is correct?`, ['Translate the name', 'Keep the registered name as written', 'Abbreviate it', 'Replace with the local branch'], 1, 'Registered names are legal identifiers. They are not translated.'),
    q(`The brief says ${residency}. A customer asks where their data is stored. What is correct?`, ['Answer generally that it is secure', 'Translate the client policy as written and flag the question if the policy does not answer it', 'Answer from your own knowledge', 'Skip the question in the reply'], 1, 'This is a compliance answer, not a linguistic one. Translate the policy exactly; the flag is how the client learns their policy has a gap.'),
    q(`The target language has a formal and an informal "you". Which do you use?`, ['Informal — it is friendlier', 'Whatever the client style guide names; if it names none, flag it', 'Formal, always', 'Alternate by paragraph'], 1, 'Register is a client decision and it must be held for all 150 replies. Guessing produces an inconsistent file.'),
    q(`A reply quotes a percentage discount and a cap. The cap is described in words. What is the risk of translating only the percentage accurately?`, ['None, the percentage is the offer', 'The cap limits the offer; losing it overstates what was promised', 'The cap is a detail', 'The words are unambiguous in any language'], 1, 'A promise without its cap is a bigger promise. Amounts and limits both have to survive.'),
    q(`A phone number and an email address appear in a reply. What do you do?`, ['Translate the domain', 'Keep them byte for byte', 'Reformat the phone number for the target country', 'Remove them'], 1, 'Addresses are identifiers. Reformatting a number can make it undialable.'),
    q(`A reply is a template with a customer name in a placeholder. The placeholder does not exist in the target grammar. What is correct?`, ['Drop the placeholder', 'Restructure the sentence so the placeholder still works, and note it', 'Leave it in the wrong position', 'Replace the name with "customer"'], 1, 'Restructuring is translation. Dropping the personalisation or breaking the variable is a system failure in production.'),
    q(`You finish 145 of 150 replies and five depend on a policy you cannot find. What is the correct submission?`, ['145, no mention', '145 plus a note naming the five and the missing policy', '150 with the five roughly translated', 'Hold everything'], 1, 'A handover that names what is blocked is complete. A rough translation of a policy sentence is the one thing you may not ship.'),
    q(`A reply contains humour. What is the correct approach?`, ['Translate it literally', 'Translate the intent, and flag it if the humour carries meaning', 'Remove it', 'Replace with a local joke'], 1, 'Literal humour usually lands as rudeness. Intent plus a flag is the safe rendering; inventing a joke changes the message.'),
    q(`Which of these makes your translated file auditable?`, ['Smooth prose', 'A glossary plus a flags list naming every judgement call', 'Word-for-word fidelity', 'Fast delivery'], 1, 'The sample is re-checked against the glossary and flags. Judgement calls recorded are defensible; judgement calls hidden are not.'),
    q(`A source reply contains a typo that changes the amount ("1O0" for "100"). What do you do?`, ['Translate as 100', 'Translate as written and flag the typo', 'Leave the token untranslated', 'Fix it silently'], 1, 'You may be right and the client still needs to know their template is emitting a wrong amount.'),
    q(`The customer replies in the target language asking a question the source thread never covered. What do you do?`, ['Answer it yourself', 'Translate the thread and flag the uncovered question', 'Ignore the message', 'Translate it and answer from the policy'], 1, 'Answering makes you the client. Flagging is how a real gap in their coverage gets closed.'),
  ]
}

/**
 * The six cards per region, as one flat list.
 *
 * Every id is region-prefixed (`job-africa-…`, `job-americas-…`) so an application, a training
 * payment and an assessment pass can never be confused between regions — which matters because a
 * member can change region by changing where they connect from, and their old paid training is tied
 * to the old card id, not to a category.
 */
export function seedRegionalJobs(): Job[] {
  return [
    ...cardsForRegion('Africa', {
      data: 9, review: 11, research: 13, transcription: 10, labels: 8, translation: 12,
    }),
    ...cardsForRegion('Americas', {
      data: 34, review: 42, research: 48, transcription: 36, labels: 31, translation: 38,
    }),
    ...cardsForRegion('Europe', {
      data: 30, review: 37, research: 43, transcription: 32, labels: 27, translation: 34,
    }),
    ...cardsForRegion('Asia', {
      data: 20, review: 25, research: 29, transcription: 22, labels: 18, translation: 24,
    }),
  ]
}

/**
 * The ids this module seeds.
 *
 * The canonical list lives in `lib/afterworks-data.ts` (next to the other importable batches, which
 * is what the console and the seed script read). A test asserts the two agree, so a card added here
 * cannot be silently unimportable.
 */
export const SEEDED_REGIONAL_JOB_IDS = seedRegionalJobs().map((job) => job.id) as readonly string[]
