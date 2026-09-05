'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  FileText,
  Lock,
  PartyPopper,
  RotateCcw,
  Settings,
} from 'lucide-react'
import type { Job } from '@/lib/afterworks-data'
import { cn } from '@/lib/utils'

/**
 * Training, delivered as a course instead of a wall of text.
 *
 * Sections come from the admin-authored `trainingNotes` on the job card when present; otherwise the
 * built-in per-category modules are used. Workers open one section at a time, mark it complete and
 * move to the next — progress is remembered per tab-set (sessionStorage) so a refresh does not send
 * them back to section 1. When the last section is finished the parent is notified, which is what
 * unlocks the assessment on the training page.
 */

export type TrainingSectionView = { title: string; text: string }

function progressKey(jobId: string): string {
  return `aw_training_progress:${jobId}`
}

function readStoredDone(jobId: string): number {
  try {
    const raw = window.sessionStorage.getItem(progressKey(jobId))
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  } catch {
    return 0
  }
}

function writeStoredDone(jobId: string, done: number): void {
  try {
    window.sessionStorage.setItem(progressKey(jobId), String(done))
  } catch {
    /* private mode — progress simply will not survive a refresh */
  }
}

/** The sections a worker must complete for this job: admin-authored notes first, category defaults as fallback. */
export function getJobTrainingSections(job: Job): TrainingSectionView[] {
  const authored = (job.trainingNotes ?? [])
    .map((section) => ({ title: String(section?.title ?? '').trim(), text: String(section?.content ?? '').trim() }))
    .filter((section) => section.title || section.text)
  if (authored.length > 0) return authored
  return categoryModules(job)
}

/** Where a worker left off. Safe to call during render (reads sessionStorage, never writes). */
export function readTrainingProgress(job: Job): { done: number; total: number; complete: boolean } {
  const total = getJobTrainingSections(job).length
  const done = typeof window === 'undefined' ? 0 : Math.min(readStoredDone(job.id), total)
  return { done, total, complete: total > 0 && done >= total }
}

const SECTION_ICONS = [BookOpen, CheckCircle2, AlertTriangle, Settings, FileText]

function sectionIcon(index: number) {
  const Icon = SECTION_ICONS[index % SECTION_ICONS.length]
  return <Icon className="size-5 text-primary" />
}

export function TrainingModules({ job, onComplete, onReset }: { job: Job; onComplete?: () => void; onReset?: () => void }) {
  const sections = useMemo(() => getJobTrainingSections(job), [job])
  const total = sections.length

  // `done` = how many sections are marked complete. The section at index `done` is the one being
  // studied right now (locked ones are everything after it).
  const [done, setDone] = useState(0)
  const [openIndex, setOpenIndex] = useState(0)

  useEffect(() => {
    const stored = Math.min(readStoredDone(job.id), total)
    setDone(stored)
    setOpenIndex(Math.min(stored, Math.max(0, total - 1)))
  }, [job.id, total])

  const complete = total > 0 && done >= total

  useEffect(() => {
    if (complete) onComplete?.()
  }, [complete, onComplete])

  const completeSection = useCallback(() => {
    setDone((prev) => {
      const next = Math.min(prev + 1, total)
      writeStoredDone(job.id, next)
      setOpenIndex(Math.min(next, Math.max(0, total - 1)))
      return next
    })
  }, [job.id, total])

  const resetProgress = useCallback(() => {
    setDone(0)
    setOpenIndex(0)
    try {
      window.sessionStorage.removeItem(progressKey(job.id))
    } catch {
      /* ignore */
    }
    onReset?.()
  }, [job.id, onReset])

  const isAuthored = (job.trainingNotes ?? []).length > 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  if (total === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {/* Course header + progress */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BookOpen className="size-4.5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {isAuthored ? 'Training course' : `${job.category} training course`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {complete ? 'All sections completed' : `Section ${Math.min(done + 1, total)} of ${total}`}
              </p>
            </div>
          </div>
          <span className="font-mono text-xs font-semibold tabular text-muted-foreground">{pct}%</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all duration-500', complete ? 'bg-success' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Sections: completed ones can be re-opened for review, the current one is open, the rest are locked */}
      <ul className="flex flex-col gap-3">
        {sections.map((section, index) => {
          const state = index < done ? 'completed' : index === done ? 'current' : 'locked'
          const isOpen = state !== 'locked' && openIndex === index
          return (
            <li
              key={index}
              className={cn(
                'overflow-hidden rounded-xl border transition-colors',
                state === 'current' && 'border-primary/50 bg-card shadow-sm ring-1 ring-primary/20',
                state === 'completed' && 'border-success/30 bg-success/5',
                state === 'locked' && 'border-border/60 bg-muted/20 opacity-70',
              )}
            >
              <button
                type="button"
                disabled={state === 'locked'}
                onClick={() => setOpenIndex(isOpen && state === 'completed' ? -1 : index)}
                className="flex w-full items-center gap-3 p-4 text-left disabled:cursor-not-allowed"
                aria-expanded={isOpen}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    state === 'completed' && 'bg-success/20 text-success',
                    state === 'current' && 'bg-primary/15 font-mono text-primary',
                    state === 'locked' && 'bg-muted text-muted-foreground',
                  )}
                >
                  {state === 'completed' ? <CheckCircle2 className="size-4" /> : state === 'locked' ? <Lock className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm font-semibold', state === 'locked' ? 'text-muted-foreground' : 'text-foreground')}>
                    {section.title || `Section ${index + 1}`}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {state === 'completed' ? 'Completed — tap to review' : state === 'current' ? 'Study this section, then continue' : 'Unlocks when the previous section is complete'}
                  </span>
                </span>
                {state !== 'locked' && (
                  <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                )}
              </button>

              {isOpen && (
                <div className="border-t border-border/60 p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0">{sectionIcon(index)}</span>
                    <div className="min-w-0 flex-1 text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap">{section.text}</div>
                  </div>

                  {state === 'current' && (
                    <div className="mt-5 flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] text-muted-foreground">
                        {index === total - 1
                          ? 'This is the final section. Finish the course to unlock the assessment.'
                          : `Section ${index + 1} of ${total} — the next section unlocks when you continue.`}
                      </p>
                      <button
                        type="button"
                        onClick={completeSection}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                      >
                        {index === total - 1 ? (
                          <>
                            <PartyPopper className="size-4" />
                            Finish training
                          </>
                        ) : (
                          <>
                            Mark complete &amp; next section
                            <ArrowRight className="size-4" />
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Completion panel */}
      {complete && (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-success/40 bg-success/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-8 shrink-0 text-success" />
            <div>
              <p className="text-sm font-semibold text-success">Training complete</p>
              <p className="text-xs text-muted-foreground">
                You finished all {total} section{total === 1 ? '' : 's'}. The assessment below is now unlocked.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetProgress}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            Retake course
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Ungated note viewer for assessment-only job cards: the admin can still publish preparation
 * notes, and workers can expand them freely — there is no payment or sequencing to enforce.
 */
export function TrainingNotesPreview({ job }: { job: Job }) {
  const sections = (job.trainingNotes ?? [])
    .map((section) => ({ title: String(section?.title ?? '').trim(), text: String(section?.content ?? '').trim() }))
    .filter((section) => section.title || section.text)
  const [open, setOpen] = useState<number | null>(0)

  if (sections.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {sections.map((section, index) => (
          <li key={index} className="overflow-hidden rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setOpen(open === index ? null : index)}
              className="flex w-full items-center gap-3 p-3.5 text-left"
              aria-expanded={open === index}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <StickyNoteIcon />
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{section.title || `Note ${index + 1}`}</span>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open === index && 'rotate-180')} />
            </button>
            {open === index && (
              <div className="border-t border-border/60 p-4 text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap">{section.text}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StickyNoteIcon() {
  return <FileText className="size-3.5" />
}

// ─── Built-in fallback content (per category) ────────────────────────────────

function categoryModules(job: Job): TrainingSectionView[] {
  const contentMap: Record<string, TrainingSectionView[]> = {
    'Transcription': [
      {
        title: 'Module 1: Introduction & Core Objective',
        text: `In this role, you will be transcribing audio files into text. The core objective is capturing every spoken word accurately while adhering to the specified verbatim style. Your work directly trains voice recognition models and provides accessibility, making precision critical. \n\n**Job specifics:** ${job.description}`,
      },
      {
        title: 'Module 2: Quality Standards & QA',
        text: 'Our Quality Assurance (QA) team regularly audits submissions. We expect a minimum of 98% accuracy. This means correct spelling, proper punctuation, and accurate speaker identification. Falling below this threshold consistently will result in account suspension.',
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        text: 'Expect to encounter overlapping speech, thick accents, and heavy background noise. \n- **Overlapping Speech:** Always use separate speaker labels with exact timestamps.\n- **Unintelligible Audio:** If you cannot understand a word after listening 3 times, use the `[inaudible]` or `[unclear]` tag.\n- **Stutters/Filler Words:** Follow the project guidelines (strict verbatim requires capturing "um" and "uh", clean verbatim requires removing them).',
      },
      {
        title: 'Module 4: Formatting Guidelines',
        text: 'Always format speaker changes on a new line (e.g., "Speaker 1:"). Timestamps should be added at every speaker change or every 2 minutes of continuous speech unless instructed otherwise. Spell out numbers one through nine, and use numerals for 10 and above.',
      },
    ],
    'Data Entry': [
      {
        title: 'Module 1: Introduction & Core Objective',
        text: `You will be extracting structured data from receipts, invoices, and handwritten forms. Your core objective is to digitize analog information exactly as it appears on the source document. \n\n**Job specifics:** ${job.description}`,
      },
      {
        title: 'Module 2: Quality Standards & QA',
        text: 'Data entry demands 100% accuracy, especially on numeric fields like IDs, phone numbers, and financial totals. A single wrong digit invalidates the entire record. QA will sample your work, and precision is prioritized over speed.',
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        text: 'You will frequently see illegible handwriting, missing dates, or calculation errors on receipts.\n- **Errors on Source:** If a receipt total is calculated wrong, enter the total *exactly as written* on the receipt, do not fix their math.\n- **Blank Fields:** If a field is empty, leave the entry blank or use the designated N/A code. Do not guess.\n- **Illegible Text:** Use the `[unclear]` tag for completely unreadable words.',
      },
      {
        title: 'Module 4: Formatting Guidelines',
        text: 'Always format dates strictly as YYYY-MM-DD regardless of how they appear on the form (unless otherwise instructed). Omit currency symbols ($, €, £) from numeric amount fields. Ensure email addresses are entered in lowercase without trailing spaces.',
      },
    ],
    'Image Labeling': [
      {
        title: 'Module 1: Introduction & Core Objective',
        text: `Your task is to draw precise bounding boxes or polygons around objects of interest in images. This data is used to train computer vision AI models (like self-driving cars or medical imaging). \n\n**Job specifics:** ${job.description}`,
      },
      {
        title: 'Module 2: Quality Standards & QA',
        text: 'The most important metric is "tightness". A bounding box must tightly enclose the visible parts of the object—all four edges of the box should touch the outermost pixels of the target object. Loose boxes or boxes that cut off the object will be rejected by QA.',
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        text: 'You must correctly handle occlusion and truncation.\n- **Occlusion:** If a car is partially blocked by a tree, only draw the box around the *visible* parts of the car.\n- **Truncation:** If an object is cut off by the edge of the image, draw the box exactly up to the edge.\n- **Shadows/Reflections:** Exclude shadows and mirror reflections from your bounding boxes unless explicitly asked to include them.',
      },
      {
        title: 'Module 4: Tooling & Categorization',
        text: 'Ensure you select the most specific category available for an object. If a vehicle is towing a trailer, draw two separate bounding boxes (one for the vehicle, one for the trailer). Do not label objects that are too small to identify without extreme zooming.',
      },
    ],
    'Content Review': [
      {
        title: 'Module 1: Introduction & Core Objective',
        text: `You will evaluate user-generated text, images, or videos against platform safety policies. Your core objective is to maintain a safe environment by accurately identifying and actioning violating content. \n\n**Job specifics:** ${job.description}`,
      },
      {
        title: 'Module 2: Quality Standards & QA',
        text: 'Reviewers must remain 100% objective. You must separate your personal biases or offense from the written policy. QA audits rely entirely on whether your decision matches the strict letter of the platform guidelines.',
      },
      {
        title: 'Module 3: Edge Cases & Escalations',
        text: 'Not all content is black and white.\n- **Borderline Content:** Content that is highly offensive but doesn\'t technically cross the line into hate speech or harassment must usually be allowed.\n- **Context Matters:** A word might be a slur in one context, but a reclaimed term or historical reference in another.\n- **Escalations:** Any indication of imminent self-harm, terrorism, or CSAM must be immediately escalated through the emergency protocol.',
      },
      {
        title: 'Module 4: Tagging Guidelines',
        text: 'When removing content, you must apply the correct violation tag (e.g., "Hate Speech", "Spam", "Harassment"). If multiple violations exist, choose the most severe one. Always leave clear, concise audit notes if the decision was ambiguous.',
      },
    ],
    'Translation': [
      {
        title: 'Module 1: Introduction & Core Objective',
        text: `You will translate text from a source language to a target language. The objective is to convey the original meaning accurately, naturally, and fluently in the target language. \n\n**Job specifics:** ${job.description}`,
      },
      {
        title: 'Module 2: Quality Standards & QA',
        text: 'Literal, word-for-word translation is unacceptable because grammar rules differ between languages. QA grades based on meaning preservation, natural flow, and adherence to the intended tone (e.g., formal legal vs. casual marketing).',
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        text: 'You will encounter cultural idioms and untranslatable concepts.\n- **Idioms:** Never translate idioms literally (e.g., "it\'s raining cats and dogs"). Find an equivalent idiom in the target language or simply translate the underlying meaning.\n- **Typos in Source:** If the source text contains a typo, ignore it and translate the *intended* meaning.\n- **Ambiguity:** Use contextual clues to resolve ambiguous sentences rather than guessing.',
      },
      {
        title: 'Module 4: Formatting & Localization',
        text: 'Always preserve HTML formatting tags (like `<b>` or `<br>`) exactly as they appear. Do not translate trademarked brand names unless they have an established localized name. Convert dates and measurements to match the standard conventions of the target locale if instructed.',
      },
    ],
    'Research': [
      {
        title: 'Module 1: Introduction & Core Objective',
        text: `You will verify, find, and update business contact details or specific data points using web searches. The goal is to build a highly accurate, up-to-date database. \n\n**Job specifics:** ${job.description}`,
      },
      {
        title: 'Module 2: Quality Standards & QA',
        text: 'Accuracy and source credibility are paramount. Entering incorrect data defeats the purpose of verification. QA will check your submitted data against the exact source URL you provide to ensure they match perfectly.',
      },
      {
        title: 'Module 3: Common Pitfalls & Edge Cases',
        text: 'Information online is often conflicting or outdated.\n- **Conflicting Info:** If a business\'s website lists one phone number but their Facebook page lists another, the official website is your primary source of truth.\n- **Dead Links:** If a link returns a 404 error, mark the field as invalid/missing.\n- **Not Found:** If you cannot find any credible info after a thorough search, use the "Cannot Verify" tag rather than guessing.',
      },
      {
        title: 'Module 4: Sourcing Guidelines',
        text: 'Only use official company websites or credible public registries. Wikipedia and random blogs are not primary sources. Always copy the *exact* deep-link URL where you found the information, not just the homepage. Format phone numbers with appropriate country codes.',
      },
    ],
  }

  if (contentMap[job.category]) return contentMap[job.category]

  return [
    {
      title: 'Module 1: Job Overview',
      text: `Please review the specific requirements for this task carefully. \n\n**Job specifics:** ${job.description}`,
    },
    {
      title: 'Module 2: Quality & Accuracy',
      text: 'QA will sample your work to ensure it meets our accuracy standards. Take your time, follow instructions precisely, and do not rush.',
    },
    {
      title: 'Module 3: Edge Cases',
      text: 'If you encounter a scenario not covered in the instructions, please use your best judgment, flag the task for review, or use the `[unclear]` tag where applicable.',
    },
    {
      title: 'Module 4: Submission Guidelines',
      text: 'Ensure all required fields are filled out before submitting. Double-check your work for typos or formatting errors.',
    },
  ]
}
