/**
 * Region-scoped job cards — the seeded content each region's board opens on.
 *
 * Three cards per region, one in a different category, each with its own training sections, its own
 * training fee and **its own assessment**. The assessment matters more than it looks: each card here
 * carries twenty authored questions, because `lib/assessment-bank.ts` deliberately returns an empty
 * bank for a category rather than serving an easy quiz, and a card whose id is not in the bank would
 * otherwise refuse every attempt with "this job has no assessment".
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

const JOB_UNIT_NAMES: Record<JobRegion, string> = {
  Africa: 'African queues',
  Americas: 'Americas queues',
  Europe: 'European queues',
  Asia: 'Asian queues',
}

/** Build one region's three cards. Kept as a function so ids and region fields cannot drift. */
function cardsForRegion(region: JobRegion, pay: { data: number; review: number; research: number }): Job[] {
  const fee = REGION_FEE[region]
  const closesAt = new Date(Date.now() + 21 * 86400_000).toISOString()

  return [
    {
      id: regionalJobId(region, 'invoice-entry'),
      title: `Enter supplier invoices from ${JOB_REGION_LABELS[region]} clients`,
      category: 'Data Entry',
      region,
      description:
        'A monthly batch of scanned supplier invoices from clients in your region, entered into a fixed accounts template. Some scans are skewed, a few carry handwritten corrections, and two are deliberately the same invoice filed twice.',
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
        'Review a queue of product listings for a marketplace operating in your region. Mark the ones that breach the written policy, leave the rest alone, and record a one-line reason for every removal.',
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
        'Build a price comparison for a client entering your region. Twenty named retailers, four products each, with the shelf price, the promo price and the date you checked — sourced only from pages you actually opened.',
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

/**
 * The three cards per region, as one flat list.
 *
 * Every id is region-prefixed (`job-africa-…`, `job-americas-…`) so an application, a training
 * payment and an assessment pass can never be confused between regions — which matters because a
 * member can change region by changing where they connect from, and their old paid training is tied
 * to the old card id, not to a category.
 */
export function seedRegionalJobs(): Job[] {
  return [
    ...cardsForRegion('Africa', { data: 9, review: 11, research: 13 }),
    ...cardsForRegion('Americas', { data: 34, review: 42, research: 48 }),
    ...cardsForRegion('Europe', { data: 30, review: 37, research: 43 }),
    ...cardsForRegion('Asia', { data: 20, review: 25, research: 29 }),
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
