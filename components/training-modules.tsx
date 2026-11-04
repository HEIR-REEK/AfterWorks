'use client'

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  GraduationCap,
  HelpCircle,
  Lock,
  PartyPopper,
  RotateCcw,
  ShieldCheck,
  Target,
  XCircle,
} from 'lucide-react'
import {
  type Job,
  type TrainingCheck,
  type TrainingLessonKind,
  type TrainingSection,
} from '@/lib/afterworks-data'
import {
  getJobTrainingCourse,
  trainingCourseMinutes,
} from '@/lib/training-curriculum'
import { TrainingFigure } from '@/components/training-figure'
import { cn } from '@/lib/utils'

/**
 * Training, delivered as a coursebook instead of a wall of text.
 *
 * Content comes from a short admin-authored briefing when the card has one, followed by the job's
 * built-in category course from `lib/training-curriculum.ts` (five or more authored lessons replace
 * the category course). A built-in course is twelve lessons across seven units, mixing concept,
 * scenario, lab and checkpoint lessons, each with an objective, a figure and often a quick check.
 * Workers open one lesson at a time, pass its check, mark it complete and move on. Progress is
 * remembered per job so a refresh does not send them back to lesson 1. When the last lesson is
 * finished the parent is notified, which unlocks the assessment.
 */

export type TrainingSectionView = TrainingSection

const LESSON_KIND_LABEL: Record<TrainingLessonKind, string> = {
  concept: 'Concept',
  scenario: 'Scenario',
  lab: 'Lab',
  checkpoint: 'Checkpoint',
}

const LESSON_KIND_STYLE: Record<TrainingLessonKind, string> = {
  concept: 'bg-primary/10 text-primary',
  scenario: 'bg-warning/15 text-warning',
  lab: 'bg-success/15 text-success',
  checkpoint: 'bg-accent text-accent-foreground',
}

/** Group a flat lesson list into the units shown in the coursebook. */
function groupUnits(sections: TrainingSection[]): { unit: string; sections: { section: TrainingSection; index: number }[] }[] {
  const groups: { unit: string; sections: { section: TrainingSection; index: number }[] }[] = []
  sections.forEach((section, index) => {
    const unit = section.unit || 'Course lessons'
    let group = groups[groups.length - 1]
    if (!group || group.unit !== unit) {
      group = { unit, sections: [] }
      groups.push(group)
    }
    group.sections.push({ section, index })
  })
  return groups
}

function lessonKind(section: TrainingSection): TrainingLessonKind {
  return section.kind ?? 'concept'
}

function progressKey(jobId: string): string {
  return `aw_training_progress:${jobId}`
}

function completionKey(jobId: string): string {
  return `aw_training_complete:${jobId}`
}

function readStoredDone(jobId: string): number {
  try {
    // Prefer localStorage (persists across tab closes) with sessionStorage as a fallback
    // for browsers that block localStorage in private mode.
    const raw =
      window.localStorage.getItem(progressKey(jobId)) ??
      window.sessionStorage.getItem(progressKey(jobId))
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  } catch {
    return 0
  }
}

function writeStoredDone(jobId: string, done: number): void {
  try {
    window.localStorage.setItem(progressKey(jobId), String(done))
  } catch {
    try {
      window.sessionStorage.setItem(progressKey(jobId), String(done))
    } catch {
      /* private mode — progress simply will not survive a refresh */
    }
  }
}

/** Persist an "all lessons done" flag separately so the training page can detect completion
 *  even after a full tab restart wipes the in-memory state. */
export function markTrainingComplete(jobId: string): void {
  try {
    window.localStorage.setItem(completionKey(jobId), '1')
  } catch {
    try {
      window.sessionStorage.setItem(completionKey(jobId), '1')
    } catch {
      /* ignore */
    }
  }
}

export function isTrainingMarkedComplete(jobId: string): boolean {
  try {
    return (
      window.localStorage.getItem(completionKey(jobId)) === '1' ||
      window.sessionStorage.getItem(completionKey(jobId)) === '1'
    )
  } catch {
    return false
  }
}

/** The lessons a worker must complete for this job: authored notes first, category course as fallback. */
export function getJobTrainingSections(job: Job): TrainingSectionView[] {
  return getJobTrainingCourse(job).modules
}

/** Where a worker left off. Safe to call during render. */
export function readTrainingProgress(job: Job): { done: number; total: number; complete: boolean } {
  const total = getJobTrainingSections(job).length
  if (typeof window === 'undefined') return { done: 0, total, complete: false }
  if (isTrainingMarkedComplete(job.id)) return { done: total, total, complete: true }

  const done = Math.min(readStoredDone(job.id), total)
  return { done, total, complete: total > 0 && done >= total }
}

// ─── Inline formatting and figures ──────────────────────────────────────────

/**
 * A deliberately tiny renderer for authored course prose. It supports paragraphs, `###`
 * sub-headings, `-` bullets, numbered lists, `- [ ]` checklist items, `**bold**`, and
 * `` `code` ``. It never uses `dangerouslySetInnerHTML`, so a pasted note cannot inject markup.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let index = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${index}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      )
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c-${index}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      )
    }
    lastIndex = pattern.lastIndex
    index += 1
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function TrainingContent({ text }: { text: string }) {
  const normalized = text.replace(/\\n/g, '\n').trim()
  if (!normalized) return null
  const blocks = normalized.split(/\n{2,}/)

  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground/85">
      {blocks.map((rawBlock, blockIndex) => {
        const lines = rawBlock
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        if (lines.length === 0) return null

        if (lines.every((line) => line.startsWith('>'))) {
          const quote = lines.map((line) => line.replace(/^>\s?/, '')).join(' ')
          return (
            <aside
              key={`quote-${blockIndex}`}
              className="rounded-r-xl border-l-4 border-primary bg-primary/[0.04] px-3.5 py-3 text-sm leading-relaxed text-foreground/85"
            >
              {renderInline(quote, `quote-${blockIndex}`)}
            </aside>
          )
        }

        if (lines[0].startsWith('### ')) {
          const heading = lines[0].slice(4)
          const rest = lines.slice(1)
          return (
            <Fragment key={`block-${blockIndex}`}>
              <h4 className="mt-1 text-sm font-semibold text-foreground">{heading}</h4>
              {rest.length > 0 && (
                <p className="whitespace-pre-line">
                  {renderInline(rest.join(' '), `block-${blockIndex}`)}
                </p>
              )}
            </Fragment>
          )
        }

        if (lines.every((line) => /^[-*•]\s+\[[ xX]\]\s+/.test(line) || /^\[[ xX]\]\s+/.test(line))) {
          return (
            <ul key={`block-${blockIndex}`} className="flex flex-col gap-1.5 rounded-xl border border-border/70 bg-muted/20 p-3">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex} className="flex items-start gap-2 text-xs">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                  <span>
                    {renderInline(
                      line.replace(/^[-*•]\s+/, '').replace(/^\[[ xX]\]\s+/, ''),
                      `check-${blockIndex}-${lineIndex}`,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )
        }

        if (lines.every((line) => /^[-*•]\s+/.test(line))) {
          return (
            <ul key={`block-${blockIndex}`} className="flex flex-col gap-1.5 pl-1">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/70" />
                  <span>{renderInline(line.replace(/^[-*•]\s+/, ''), `ul-${blockIndex}-${lineIndex}`)}</span>
                </li>
              ))}
            </ul>
          )
        }

        if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
          return (
            <ol key={`block-${blockIndex}`} className="flex flex-col gap-1.5 pl-1">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex} className="flex gap-2">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-semibold text-primary">
                    {line.match(/^\d+/)?.[0]}
                  </span>
                  <span>{renderInline(line.replace(/^\d+[.)]\s+/, ''), `ol-${blockIndex}-${lineIndex}`)}</span>
                </li>
              ))}
            </ol>
          )
        }

        return (
          <p key={`block-${blockIndex}`} className="whitespace-pre-line">
            {renderInline(lines.join('\n'), `p-${blockIndex}`)}
          </p>
        )
      })}
    </div>
  )
}

// ─── Lesson knowledge check ─────────────────────────────────────────────────

function ModuleCheck({
  check,
  passed,
  onPassed,
}: {
  check: TrainingCheck
  passed: boolean
  onPassed: () => void
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const [attempts, setAttempts] = useState(0)
  const correct = selected === check.correctIndex
  const answered = selected !== null

  const choose = (index: number) => {
    // Once the check is correct, keep the passed answer visible instead of letting a stray click
    // turn a passed lesson back into a wrong-looking one.
    if (selected === check.correctIndex) return
    setSelected(index)
    setAttempts((value) => value + 1)
    if (index === check.correctIndex) onPassed()
  }

  return (
    <div className="mt-5 rounded-xl border border-primary/20 bg-primary/[0.035] p-3.5 sm:p-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <HelpCircle className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
            Quick check {passed ? '· passed' : ''}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">{check.question}</p>
        </div>
      </div>

      {check.image && (
        <TrainingFigure src={check.image} alt={check.imageAlt} className="mt-3" />
      )}

      <div className="mt-3 grid gap-2">
        {check.options.map((option, index) => {
          const isSelected = selected === index
          const isCorrect = index === check.correctIndex
          return (
            <button
              key={index}
              type="button"
              onClick={() => choose(index)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                !isSelected && 'border-border bg-background hover:border-primary/40 hover:bg-primary/[0.03]',
                isSelected && isCorrect && 'border-success/50 bg-success/10 text-success',
                isSelected && !isCorrect && 'border-destructive/40 bg-destructive/5 text-destructive',
                !isSelected && answered && isCorrect && 'border-success/40 bg-success/5',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold',
                  isSelected && isCorrect && 'border-success bg-success text-white',
                  isSelected && !isCorrect && 'border-destructive bg-destructive text-white',
                  !isSelected && 'border-border text-muted-foreground',
                )}
              >
                {isSelected ? (isCorrect ? '✓' : '×') : String.fromCharCode(65 + index)}
              </span>
              <span>{option}</span>
            </button>
          )
        })}
      </div>

      {answered && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            correct
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-destructive/30 bg-destructive/5 text-destructive',
          )}
        >
          {correct ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
          <span>
            <span className="font-semibold">{correct ? 'Correct. ' : 'Not quite. '}</span>
            {check.explanation ?? (correct ? 'You can finish this lesson.' : 'Try another answer.')}
          </span>
        </div>
      )}

      {answered && !correct && attempts > 0 && (
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="mt-2 text-[11px] font-medium text-primary hover:underline"
        >
          Try again
        </button>
      )}
    </div>
  )
}

// ─── Course header ──────────────────────────────────────────────────────────

function CourseHeader({
  job,
  course,
  done,
  total,
  pct,
  complete,
}: {
  job: Job
  course: ReturnType<typeof getJobTrainingCourse>
  done: number
  total: number
  pct: number
  complete: boolean
}) {
  const minutes = trainingCourseMinutes(course)
  const units = groupUnits(course.modules)
  const checkCount = course.modules.filter((section) => section.check).length
  const labCount = course.modules.filter((section) => lessonKind(section) === 'lab').length
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <GraduationCap className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                AfterWorks academy · coursebook
              </p>
              <h3 className="mt-0.5 text-base font-bold text-foreground sm:text-lg">
                {course.level.includes('job-specific')
                  ? 'Job-specific training course'
                  : `${job.category} training course`}
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {course.level} · {units.length} units · {total} lessons · {checkCount} checks · ~{minutes} min
              </p>
            </div>
          </div>
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-semibold',
              complete ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary',
            )}
          >
            {complete ? 'Completed' : `${pct}%`}
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-foreground/80">{course.summary}</p>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all duration-500', complete ? 'bg-success' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {complete
            ? `All ${total} lessons complete — the assessment is unlocked below.`
            : `Lesson ${Math.min(done + 1, total)} of ${total} is open. Finish each lesson to unlock the next.`}
        </p>

        <div className="mt-4 rounded-xl border border-border/70 bg-muted/25 p-3">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Target className="size-3.5 text-primary" />
            What you'll learn
          </p>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {course.objectives.map((objective) => (
              <li key={objective} className="flex items-start gap-2 text-xs leading-relaxed text-foreground/80">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                <span>{objective}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <BookOpen className="size-3.5 text-primary" />
            Course map
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {units.map((unit, index) => (
              <span
                key={unit.unit}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground/75"
              >
                <span className="font-mono text-[9px] text-primary">{String(index + 1).padStart(2, '0')}</span>
                {unit.unit.replace(/^Unit \d+ · /, '')}
                <span className="text-muted-foreground">· {unit.sections.length}</span>
              </span>
            ))}
            {labCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-[10px] font-semibold text-success">
                {labCount} lab{labCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </div>

      {course.heroImage && (
        <TrainingFigure
          src={course.heroImage}
          alt={course.heroAlt}
          caption={course.heroCaption}
          className="rounded-none border-x-0 border-b-0"
        />
      )}
    </div>
  )
}

// ─── Gated course ───────────────────────────────────────────────────────────

export function TrainingModules({
  job,
  onComplete,
  onReset,
}: {
  job: Job
  onComplete?: () => void
  onReset?: () => void
}) {
  const course = useMemo(() => getJobTrainingCourse(job), [job])
  const sections = course.modules
  const total = sections.length

  // `done` = how many lessons are marked complete. The lesson at index `done` is the current one;
  // everything after it is locked.
  // Start at zero on both server and client so hydration is stable; the effect below restores
  // the saved position as soon as the browser is available.
  const [done, setDone] = useState(0)
  const [openIndex, setOpenIndex] = useState(0)
  const [passedChecks, setPassedChecks] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (isTrainingMarkedComplete(job.id)) {
      setDone(total)
      setOpenIndex(Math.max(0, total - 1))
      return
    }
    const stored = Math.min(readStoredDone(job.id), total)
    setDone(stored)
    setOpenIndex(Math.min(stored, Math.max(0, total - 1)))
  }, [job.id, total])

  const complete = total > 0 && done >= total

  useEffect(() => {
    if (complete) {
      markTrainingComplete(job.id)
      onComplete?.()
    }
  }, [complete, onComplete, job.id])

  const completeSection = useCallback(() => {
    setDone((prev) => {
      const next = Math.min(prev + 1, total)
      writeStoredDone(job.id, next)
      if (next >= total) markTrainingComplete(job.id)
      setOpenIndex(Math.min(next, Math.max(0, total - 1)))
      return next
    })
  }, [job.id, total])

  const markCheckPassed = useCallback((index: number) => {
    setPassedChecks((prev) => {
      if (prev.has(index)) return prev
      const next = new Set(prev)
      next.add(index)
      return next
    })
  }, [])

  const resetProgress = useCallback(() => {
    setDone(0)
    setOpenIndex(0)
    setPassedChecks(new Set())
    try {
      window.localStorage.removeItem(progressKey(job.id))
      window.localStorage.removeItem(completionKey(job.id))
      window.sessionStorage.removeItem(progressKey(job.id))
      window.sessionStorage.removeItem(completionKey(job.id))
    } catch {
      /* ignore */
    }
    onReset?.()
  }, [job.id, onReset])

  const isAuthored = (job.trainingNotes ?? []).length > 0
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const unitStarts = new Set<number>()
  sections.forEach((section, index) => {
    if (index === 0 || sections[index - 1]?.unit !== section.unit) unitStarts.add(index)
  })
  const units = groupUnits(sections)

  if (total === 0) return null

  return (
    <div className="flex flex-col gap-4">
      <CourseHeader job={job} course={course} done={done} total={total} pct={pct} complete={complete} />

      {/* Lessons: completed ones can be re-opened for review, the current one is open, the rest are locked */}
      <ul className="flex flex-col gap-3">
        {sections.map((section, index) => {
          const state = index < done ? 'completed' : index === done ? 'current' : 'locked'
          const isOpen = state !== 'locked' && openIndex === index
          const checkPassed = !section.check || passedChecks.has(index)
          const canFinish = state !== 'current' || checkPassed
          const duration = section.durationMinutes ?? 5
          return (
            <li
              key={`${index}-${section.title}`}
              className={cn(
                'overflow-hidden rounded-xl border transition-colors',
                state === 'current' && 'border-primary/50 bg-card shadow-sm ring-1 ring-primary/20',
                state === 'completed' && 'border-success/30 bg-success/[0.03]',
                state === 'locked' && 'border-border/60 bg-muted/20 opacity-70',
              )}
            >
              {unitStarts.has(index) && (
                <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3.5 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/70">
                    {section.unit || `Unit ${units.findIndex((unit) => unit.sections.some((row) => row.index === index)) + 1}`}
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    {units.find((unit) => unit.unit === (section.unit || 'Course lessons'))?.sections.length ?? 1} lessons
                  </span>
                </div>
              )}
              <button
                type="button"
                disabled={state === 'locked'}
                onClick={() => setOpenIndex(isOpen && state === 'completed' ? -1 : index)}
                className="flex w-full items-center gap-3 p-3.5 text-left disabled:cursor-not-allowed sm:p-4"
                aria-expanded={isOpen}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    state === 'completed' && 'bg-success/20 text-success',
                    state === 'current' && 'bg-primary/15 font-mono text-primary',
                    state === 'locked' && 'bg-muted text-muted-foreground',
                  )}
                >
                  {state === 'completed' ? (
                    <CheckCircle2 className="size-4" />
                  ) : state === 'locked' ? (
                    <Lock className="size-3.5" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Lesson {index + 1}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Clock3 className="size-3" />
                      {duration} min
                    </span>
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold', LESSON_KIND_STYLE[lessonKind(section)])}>
                      {LESSON_KIND_LABEL[lessonKind(section)]}
                    </span>
                    {section.check && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold',
                          checkPassed ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary',
                        )}
                      >
                        {checkPassed ? 'check passed' : 'quick check'}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 block truncate text-sm font-semibold',
                      state === 'locked' ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {section.title || `Lesson ${index + 1}`}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {state === 'completed'
                      ? 'Completed — tap to review'
                      : state === 'current'
                        ? 'Study this lesson, pass the check, then continue'
                        : 'Unlocks when the previous lesson is complete'}
                  </span>
                </span>
                {state !== 'locked' && (
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-muted-foreground transition-transform',
                      isOpen && 'rotate-180',
                    )}
                  />
                )}
              </button>

              {isOpen && (
                <div className="border-t border-border/60 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {state === 'completed' ? (
                        <ShieldCheck className="size-4" />
                      ) : (
                        <BookOpen className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      {section.objective && (
                        <div className="mb-4 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2.5">
                          <Target className="mt-0.5 size-4 shrink-0 text-primary" />
                          <p className="text-xs leading-relaxed text-foreground/80">
                            <span className="font-semibold text-foreground">By the end: </span>
                            {section.objective}
                          </p>
                        </div>
                      )}
                      <TrainingContent text={section.content} />
                    </div>
                  </div>

                  {section.image && (
                    <TrainingFigure
                      src={section.image}
                      alt={section.imageAlt}
                      caption={section.imageCaption}
                      className="mt-4"
                    />
                  )}

                  {section.check && state === 'current' && (
                    <ModuleCheck
                      check={section.check}
                      passed={checkPassed}
                      onPassed={() => markCheckPassed(index)}
                    />
                  )}

                  {state === 'current' && (
                    <div className="mt-5 flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] text-muted-foreground">
                        {index === total - 1
                          ? 'This is the final lesson. Finish the course to unlock the assessment.'
                          : `Lesson ${index + 1} of ${total} — the next lesson unlocks when you continue.`}
                      </p>
                      <button
                        type="button"
                        onClick={completeSection}
                        disabled={!canFinish}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {index === total - 1 ? (
                          <>
                            <PartyPopper className="size-4" />
                            Finish training
                          </>
                        ) : (
                          <>
                            Mark complete &amp; next lesson
                            <ArrowRight className="size-4" />
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {state === 'current' && !canFinish && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <AlertTriangle className="size-3.5 text-warning" />
                      Answer the quick check correctly to unlock the next lesson.
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {course.glossary && course.glossary.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-3.5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-foreground">
            <span className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              Course glossary · {course.glossary.length} terms
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">Reference</span>
          </summary>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {course.glossary.map((entry) => (
              <div key={entry.term} className="rounded-lg border border-border/70 bg-muted/20 p-2.5">
                <dt className="text-[11px] font-semibold text-foreground">{entry.term}</dt>
                <dd className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{entry.definition}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {complete && (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-success/40 bg-success/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-8 shrink-0 text-success" />
            <div>
              <p className="text-sm font-semibold text-success">Training complete</p>
              <p className="text-xs text-muted-foreground">
                You finished all {total} lessons across {units.length} units. The assessment below is
                now unlocked.
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

      {isAuthored && (
        <p className="text-[11px] text-muted-foreground">
          This course includes a briefing written for this job card. Read it alongside the category
          lessons — the assessment draws on both.
        </p>
      )}
    </div>
  )
}

// ─── Ungated preview for assessment-only cards ──────────────────────────────

/**
 * The free-card counterpart: the same rich lessons, but with no payment or sequencing gate. It is
 * also the "preparation course" shown before an assessment-only card, so the questions are based on
 * material the worker can actually read.
 */
export function TrainingNotesPreview({ job }: { job: Job }) {
  const course = useMemo(() => getJobTrainingCourse(job), [job])
  const sections = course.modules
  const [open, setOpen] = useState<number | null>(0)

  if (sections.length === 0) return null
  const minutes = trainingCourseMinutes(course)
  const units = groupUnits(sections)
  const checkCount = sections.filter((section) => section.check).length

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border/60 bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-4" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              Preparation course
            </p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">
              {job.category} · {units.length} units · {sections.length} lessons · {checkCount} checks · ~{minutes} min
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{course.summary}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {units.map((unit, index) => (
            <span
              key={unit.unit}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-foreground/70"
            >
              <span className="font-mono text-[9px] text-primary">{String(index + 1).padStart(2, '0')}</span>
              {unit.unit.replace(/^Unit \d+ · /, '')}
            </span>
          ))}
        </div>
        {course.objectives.length > 0 && (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {course.objectives.map((objective) => (
              <li key={objective} className="flex items-start gap-2 text-[11px] leading-relaxed text-foreground/75">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" />
                <span>{objective}</span>
              </li>
            ))}
          </ul>
        )}
        {course.heroImage && (
          <TrainingFigure
            src={course.heroImage}
            alt={course.heroAlt}
            caption={course.heroCaption}
            className="mt-3"
          />
        )}
      </div>

      <ul className="divide-y divide-border/60">
        {sections.map((section, index) => (
          <li key={`${index}-${section.title}`}>
            <button
              type="button"
              onClick={() => setOpen(open === index ? null : index)}
              className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-muted/20"
              aria-expanded={open === index}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] font-semibold text-primary">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {section.title || `Lesson ${index + 1}`}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="size-3" />
                    {section.durationMinutes ?? 5} min
                  </span>
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold', LESSON_KIND_STYLE[lessonKind(section)])}>
                    {LESSON_KIND_LABEL[lessonKind(section)]}
                  </span>
                  <span>· tap to {open === index ? 'close' : 'read'}</span>
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform',
                  open === index && 'rotate-180',
                )}
              />
            </button>
            {open === index && (
              <div className="border-t border-border/60 p-4">
                {section.objective && (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2">
                    <Target className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <p className="text-[11px] leading-relaxed text-foreground/80">
                      <span className="font-semibold text-foreground">By the end: </span>
                      {section.objective}
                    </p>
                  </div>
                )}
                <TrainingContent text={section.content} />
                {section.image && (
                  <TrainingFigure
                    src={section.image}
                    alt={section.imageAlt}
                    caption={section.imageCaption}
                    className="mt-4"
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {course.glossary && course.glossary.length > 0 && (
        <details className="border-t border-border/60 bg-muted/15 p-3.5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-foreground">
            <span className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              Course glossary · {course.glossary.length} terms
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">Reference</span>
          </summary>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {course.glossary.map((entry) => (
              <div key={entry.term} className="rounded-lg border border-border/70 bg-background p-2.5">
                <dt className="text-[11px] font-semibold text-foreground">{entry.term}</dt>
                <dd className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{entry.definition}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}
