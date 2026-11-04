'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { JobCategory } from '@/lib/afterworks-data'
import { authedFetch, describeError } from '@/lib/client-api'
import { TrainingFigure } from '@/components/training-figure'
import { CheckCircle2, Circle, AlertCircle, BookOpen } from 'lucide-react'

type QuizQuestion = {
  id: number
  question: string
  options: string[]
  image?: string
  imageAlt?: string
}

type ReviewRow = {
  id: number
  chosen: number
  correctIndex: number
  correctOption: string
  explanation?: string
}

type ScoreResponse = {
  ok: true
  passed: boolean
  score: number
  total: number
  passMark: number
  review: ReviewRow[]
}

export function AssessmentQuiz({ category, jobId, onPass }: { category: JobCategory; jobId: string; onPass: () => void }) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [passMark, setPassMark] = useState(1)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [passed, setPassed] = useState(false)
  const [score, setScore] = useState(0)
  const [showReview, setShowReview] = useState(false)
  const [review, setReview] = useState<Record<number, ReviewRow>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const questionRef = useRef<HTMLDivElement | null>(null)
  const assessmentRef = useRef<HTMLDivElement | null>(null)

  // Questions come from the server *without* the answer key. There is no local passing flag to
  // edit: a pass exists only after POST /api/assessments wrote it to the profile.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setAnswers({})
    setSubmitted(false)
    setPassed(false)
    setReview({})
    setActive(0)
    void (async () => {
      try {
        const data = await authedFetch<{ questions: QuizQuestion[]; passMark: number }>(
          `/api/assessments?jobId=${encodeURIComponent(jobId)}`,
        )
        if (cancelled) return
        const rows = Array.isArray(data.questions) ? data.questions : []
        if (rows.length === 0) {
          setLoadError('This assessment is not available right now. Refresh the page or contact support.')
          return
        }
        setQuestions(rows)
        setPassMark(Number(data.passMark) || 1)
      } catch (err) {
        if (!cancelled) setLoadError(describeError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [jobId])

  const handleSelect = (qId: number, oIdx: number) => {
    if (submitted || submitting) return
    setAnswers((prev) => ({ ...prev, [qId]: oIdx }))
  }

  const handleSubmit = async () => {
    if (submitting || submitted) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await authedFetch<ScoreResponse>('/api/assessments', {
        method: 'POST',
        body: { jobId, answers },
      })
      setScore(Number(result.score) || 0)
      setPassMark(Number(result.passMark) || passMark)
      setPassed(result.passed === true)
      setReview(
        Object.fromEntries(
          (Array.isArray(result.review) ? result.review : []).map((row) => [row.id, row]),
        ),
      )
      setSubmitted(true)
    } catch (err) {
      setSubmitError(describeError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleProceed = () => {
    onPass()
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
        Loading your assessment…
      </div>
    )
  }

  if (loadError || questions.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <span>{loadError ?? 'This assessment is not available right now.'}</span>
      </div>
    )
  }

  if (passed) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-success/30 bg-success/5 py-12">
          <CheckCircle2 className="size-16 text-success" />
          <h3 className="text-2xl font-bold text-success-foreground">Assessment Passed!</h3>
          <p className="max-w-md text-center text-muted-foreground">
            You scored {score}/{questions.length} — at or above the {passMark}/{questions.length} pass
            mark — and demonstrated your skills for {category} tasks.
          </p>
          <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row">
            <Button onClick={handleProceed} size="lg" className="px-8">
              Proceed to Application
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setShowReview((value) => !value)}
            >
              {showReview ? 'Hide review' : 'Review answers'}
            </Button>
          </div>
        </div>

        {showReview && (
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BookOpen className="size-4 text-primary" />
              Answer review
            </h4>
            <ul className="mt-3 flex flex-col gap-4">
              {questions.map((q, index) => {
                const yourAnswer = answers[q.id]
                const row = review[q.id]
                return (
                  <li key={q.id} className="border-t border-border/60 pt-3 first:border-t-0 first:pt-0">
                    <p className="text-sm font-medium text-foreground">
                      <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
                      {q.question}
                    </p>
                    {q.image && (
                      <TrainingFigure src={q.image} alt={q.imageAlt} className="mt-2 max-w-xl" />
                    )}
                    <p className="mt-2 text-xs text-success">
                      <span className="font-semibold">Correct:</span> {row?.correctOption ?? ''}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-semibold">Your answer:</span>{' '}
                      {yourAnswer === undefined ? 'Not answered' : q.options[yourAnswer]}
                    </p>
                    {row?.explanation && (
                      <p className="mt-1.5 text-xs leading-relaxed text-foreground/75">
                        <span className="font-semibold text-foreground">Why this matters: </span>
                        {row.explanation}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    )
  }

  const answeredCount = Object.keys(answers).length
  const currentIndex = Math.min(active, questions.length - 1)
  const current = questions[currentIndex]
  const progress = Math.round((answeredCount / questions.length) * 100)

  const goTo = (index: number) => {
    setActive(Math.max(0, Math.min(questions.length - 1, index)))
    // The number grid sits above the question; scrolling the *question* into view keeps the
    // worker at the answer they just selected. Scrolling to page top made every jump a round trip
    // back down through the header, progress bar and navigator.
    if (typeof window === 'undefined') return
    requestAnimationFrame(() => {
      questionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <div ref={assessmentRef} className="flex scroll-mt-24 flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              Assessment
            </p>
            <h3 className="mt-1 text-xl font-bold">Skill Assessment</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {category} · {questions.length} questions · scenario-based
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <BookOpen className="size-3.5 text-primary" />
              Every question maps to a rule or example from the lessons.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-accent/50 px-3 py-1.5 text-sm font-medium">
            <AlertCircle className="size-4 text-primary" />
            <span>Pass mark: {passMark}/{questions.length}</span>
          </div>
        </div>

        {!submitted && (
          <>
            <div className="mt-4 flex items-center justify-between gap-3 text-[11px] font-medium text-muted-foreground">
              <span>
                Question {currentIndex + 1} of {questions.length}
              </span>
              <span>
                {answeredCount} answered · {questions.length - answeredCount} left
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Question navigator">
              {questions.map((question, index) => {
                const isAnswered = answers[question.id] !== undefined
                return (
                  <button
                    key={question.id}
                    type="button"
                    role="tab"
                    aria-selected={index === currentIndex}
                    aria-label={`Question ${index + 1}${isAnswered ? ', answered' : ', unanswered'}`}
                    onClick={() => goTo(index)}
                    className={[
                      'size-7 rounded-md border font-mono text-[10px] font-semibold transition-colors',
                      index === currentIndex
                        ? 'border-primary bg-primary text-primary-foreground'
                        : isAnswered
                          ? 'border-success/40 bg-success/10 text-success-foreground'
                          : 'border-border bg-background text-muted-foreground hover:border-primary/40',
                    ].join(' ')}
                  >
                    {index + 1}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {!submitted ? (
          <div className="mt-5 flex flex-col gap-4">
            <div
              ref={questionRef}
              className="flex scroll-mt-24 flex-col gap-4 rounded-xl border border-border/70 bg-background p-4 sm:p-5"
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-semibold text-primary">
                  {currentIndex + 1}
                </span>
                <p className="font-semibold text-base leading-relaxed text-foreground">{current.question}</p>
              </div>
              {current.image && (
                <TrainingFigure src={current.image} alt={current.imageAlt} className="max-w-2xl" />
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {current.options.map((option, optionIndex) => {
                  const isSelected = answers[current.id] === optionIndex
                  return (
                    <button
                      key={optionIndex}
                      type="button"
                      onClick={() => handleSelect(current.id, optionIndex)}
                      className={[
                        'flex items-start gap-3 rounded-xl border p-4 text-left text-sm transition-all duration-200',
                        isSelected
                          ? 'border-primary bg-primary/10 font-medium text-primary ring-1 ring-primary/20'
                          : 'border-border bg-card hover:border-primary/40 hover:bg-accent/30',
                      ].join(' ')}
                    >
                      <span className="mt-0.5 shrink-0">
                        {isSelected ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                      </span>
                      <span className="leading-snug">{option}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo(currentIndex - 1)}
                disabled={currentIndex === 0}
              >
                Previous
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                {currentIndex < questions.length - 1 ? (
                  <Button type="button" onClick={() => goTo(currentIndex + 1)}>
                    Next question
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || answeredCount < questions.length}
                    className="shadow-md"
                  >
                    {submitting ? 'Scoring…' : 'Submit answers'}
                  </Button>
                )}
                {currentIndex < questions.length - 1 && answeredCount === questions.length && (
                  <Button type="button" variant="outline" onClick={handleSubmit} disabled={submitting}>
                    {submitting ? 'Scoring…' : 'Submit answers'}
                  </Button>
                )}
              </div>
            </div>
            {submitError && (
              <p className="text-xs text-destructive" role="alert">
                {submitError}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Answer every question to submit. Use the number grid to jump back and change an answer.
            </p>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
              <p className="flex items-center gap-2 text-lg font-bold text-destructive">
                <AlertCircle className="size-5" />
                You scored {score}/{questions.length} — the pass mark is {passMark}/{questions.length}.
              </p>
              <p className="max-w-lg text-sm text-muted-foreground">
                Revisit the preparation course, then try again. Correct answers stay hidden until a
                passing attempt, so the assessment cannot be used as an answer sheet.
              </p>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={() => {
                    setAnswers({})
                    setSubmitted(false)
                    setActive(0)
                    if (typeof window !== 'undefined') {
                      requestAnimationFrame(() => {
                        assessmentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      })
                    }
                  }}
                >
                  Retake assessment
                </Button>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
