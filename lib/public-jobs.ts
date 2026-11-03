/**
 * Public, SEO-safe job catalogue types and copy.
 *
 * This module is deliberately pure: it contains no Firestore import, so a client component can
 * render a public job card without pulling `firebase-admin` into the browser bundle. The server
 * projection lives in `lib/public-jobs-server.ts`.
 *
 * The public projection is an allow-list, not `normaliseJobRecord`. A job document also contains
 * authored assessment questions (with answer indexes) and training lesson checks; none of those
 * belong in HTML, a JSON-LD block or a public API response.
 */

import type { JobCategory } from '@/lib/afterworks-data'

export type PublicJob = {
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
  trainingFeeUsd?: number
  requiresVerified: boolean
  closesAt: string
  /** ISO timestamp for datePosted; absent on older documents. */
  postedAt?: string
  postedAgo: string
}

export type PublicJobCategory = {
  slug: string
  category: JobCategory
  title: string
  description: string
  summary: string
  paragraphs: string[]
  skills: string[]
}

/**
 * Public category landing pages. These are real pages with unique copy, not query-string variants
 * of the board; that is the difference between content Google may rank and doorway pages it will
 * ignore.
 */
export const PUBLIC_JOB_CATEGORIES: readonly PublicJobCategory[] = [
  {
    slug: 'data-entry',
    category: 'Data Entry',
    title: 'Data Entry Jobs in Kenya',
    description:
      'Find paid data entry microwork on AfterWorks: structured records, spreadsheet cleanup and short verification tasks with mobile-money payouts.',
    summary: 'Structured, short data tasks with a clear brief and a reviewed submission.',
    paragraphs: [
      'Data entry work on AfterWorks is broken into short cards rather than open-ended projects. Each card explains the source material, the fields to complete, the expected time and the pay before you apply.',
      'Most tasks are spreadsheet cleanup, record transcription from a supplied image or document, and checking that an existing record matches its source. You work in your browser; you do not need to install specialist software.',
      'Every submission is reviewed against the brief. If something is unclear, ask before submitting rather than guessing — a clean revision is better than a rejected batch.',
    ],
    skills: ['Careful reading', 'Spreadsheet basics', 'Accuracy under a deadline'],
  },
  {
    slug: 'transcription',
    category: 'Transcription',
    title: 'Transcription Jobs in Kenya',
    description:
      'Paid transcription and review tasks on AfterWorks, with clear audio, written guidelines and mobile-money payouts after QA.',
    summary: 'Turn supplied audio into accurate text, following a written style sheet.',
    paragraphs: [
      'Transcription cards on AfterWorks specify the audio length, the language, the expected formatting and whether the recording is already segmented. You can listen at your own pace and submit when the file is complete.',
      'Accuracy matters more than speed. The brief tells you how to handle inaudible sections, speaker changes, punctuation and timestamps; follow it exactly so QA does not have to send the work back.',
      'Some cards include a paid training module before the assessment. The fee is shown on the card and the training material unlocks only after the required identity check is approved.',
    ],
    skills: ['Listening accuracy', 'Written English or Swahili', 'Consistent formatting'],
  },
  {
    slug: 'image-labeling',
    category: 'Image Labeling',
    title: 'Image Labeling Jobs in Kenya',
    description:
      'Paid image annotation and labelling tasks on AfterWorks, with written label definitions and reviewed submissions.',
    summary: 'Label images against a supplied definition, not a personal guess.',
    paragraphs: [
      'Image labelling cards give you the label set, examples and edge-case rules. The job is to apply those rules consistently across the images in the batch, not to decide what the label should mean.',
      'Batches are small enough to finish in one sitting. The card states how many images to expect and how long the work usually takes, so you can choose a batch that fits your schedule.',
      'QA checks a sample against the same definition. Read the edge-case notes before starting; most rejected batches come from one label being applied outside its stated boundary.',
    ],
    skills: ['Attention to visual detail', 'Consistent rule-following', 'Comfort with repetitive tasks'],
  },
  {
    slug: 'content-review',
    category: 'Content Review',
    title: 'Content Review Jobs in Kenya',
    description:
      'Paid content review and moderation tasks on AfterWorks, using written policy examples and reviewed decisions.',
    summary: 'Apply a written policy to short pieces of content and explain the decision.',
    paragraphs: [
      'Content review cards ask you to classify short items against a written policy. The policy, examples and escalation path are supplied with the card; the work is judgement within those boundaries.',
      'You are not asked to make a legal ruling. You choose the closest policy outcome, record the reason and flag anything that needs a human escalation.',
      'Review work can include sensitive material. The card says what the content involves before you accept it, and you can decline a card without affecting your account.',
    ],
    skills: ['Policy reading', 'Clear written reasoning', 'Judgement and consistency'],
  },
  {
    slug: 'translation',
    category: 'Translation',
    title: 'Translation Jobs in Kenya',
    description:
      'Paid English–Swahili translation and review tasks on AfterWorks, with terminology guidance and QA.',
    summary: 'Translate short passages with supplied terminology and a clear audience.',
    paragraphs: [
      'Translation cards state the source and target language, the audience and any terminology that must be used. Short passages are preferred so the brief can be checked against the source.',
      'The review step looks at meaning, completeness and terminology, not just whether the sentence sounds fluent. Preserve names, numbers and formatting exactly as instructed.',
      'If a card requires a language pair you do not speak, do not accept it. The assessment is there to confirm the pair before you see paid work.',
    ],
    skills: ['Fluent source and target language', 'Terminology discipline', 'Careful proofreading'],
  },
  {
    slug: 'research',
    category: 'Research',
    title: 'Research Jobs in Kenya',
    description:
      'Paid web research and verification tasks on AfterWorks, with source requirements and reviewed findings.',
    summary: 'Find and verify specific facts, with sources a reviewer can check.',
    paragraphs: [
      'Research cards ask for a small, defined set of facts rather than an open essay. You receive the questions, the acceptable source types and the format for recording each answer.',
      'Every finding needs a source that a reviewer can open. Prefer primary sources, record the URL and the date checked, and mark anything you cannot verify instead of guessing.',
      'The best research submissions are easy to audit: one answer per row, one source per answer and a short note when the source is ambiguous.',
    ],
    skills: ['Search and source evaluation', 'Structured note-taking', 'Honest uncertainty'],
  },
] as const

export function publicCategory(slug: string): PublicJobCategory | null {
  return PUBLIC_JOB_CATEGORIES.find((entry) => entry.slug === slug) ?? null
}

export function publicCategoryFor(category: JobCategory): PublicJobCategory {
  return PUBLIC_JOB_CATEGORIES.find((entry) => entry.category === category) ?? PUBLIC_JOB_CATEGORIES[0]
}

/** Stable, URL-safe public path. Document ids are opaque but bounded by the admin writer. */
export function publicJobPath(id: string): string {
  return `/work/${encodeURIComponent(id)}`
}

export function publicCategoryPath(slug: string): string {
  return `/work/category/${slug}`
}

/**
 * Serialize data for a `type="application/ld+json"` block.
 *
 * `JSON.stringify` alone is not enough: a job description containing `</script>` would terminate
 * the script element in the HTML parser, so escape the three characters that can change the
 * parser's state. The result is still valid JSON.
 */
export function jsonLd(value: unknown): string {
  const backslash = String.fromCharCode(92)
  return JSON.stringify(value)
    .replace(/</g, `${backslash}u003c`)
    .replace(/>/g, `${backslash}u003e`)
    .replace(/&/g, `${backslash}u0026`)
}
