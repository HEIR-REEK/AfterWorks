'use client'

import { useEffect, useState } from 'react'
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

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl bg-card p-6 border border-border shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-border">
          <div>
            <h3 className="text-xl font-bold">Skill Assessment</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {category} · based on the preparation course
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <BookOpen className="size-3.5 text-primary" />
              Every question maps to a rule or example from the lessons.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-accent/50 px-3 py-1.5 rounded-lg text-sm font-medium">
            <AlertCircle className="size-4 text-primary" />
            <span>Pass mark: {passMark}/{questions.length}</span>
          </div>
        </div>

        <div className="flex flex-col gap-10">
          {questions.map((q, i) => (
            <div key={q.id} className="flex flex-col gap-4">
              <p className="font-semibold text-base leading-relaxed text-foreground">
                <span className="text-muted-foreground mr-2">{i + 1}.</span>
                {q.question}
              </p>
              {q.image && (
                <TrainingFigure
                  src={q.image}
                  alt={q.imageAlt}
                  className="max-w-2xl"
                />
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {q.options.map((opt, oIdx) => {
                  const isSelected = answers[q.id] === oIdx
                  const isCorrect = review[q.id]?.correctIndex === oIdx
                  
                  let optionClass = "flex items-start gap-3 p-4 rounded-xl border text-left text-sm transition-all duration-200 "
                  if (!submitted) {
                    optionClass += isSelected 
                      ? "border-primary bg-primary/10 text-primary font-medium ring-1 ring-primary/20" 
                      : "border-border bg-card hover:border-primary/40 hover:bg-accent/30"
                  } else {
                    if (isCorrect) {
                      optionClass += "border-success bg-success/15 text-success-foreground font-medium ring-1 ring-success/30"
                    } else if (isSelected) {
                      optionClass += "border-destructive bg-destructive/15 text-destructive-foreground font-medium ring-1 ring-destructive/30"
                    } else {
                      optionClass += "border-border bg-card/50 opacity-40 grayscale"
                    }
                  }

                  return (
                    <button
                      key={oIdx}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleSelect(q.id, oIdx)}
                      className={optionClass}
                    >
                      <div className="mt-0.5 shrink-0">
                        {isSelected ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                      </div>
                      <span className="leading-snug">{opt}</span>
                    </button>
                  )
                })}
              </div>
              {submitted && review[q.id]?.explanation && (
                <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs leading-relaxed text-foreground/80">
                  <BookOpen className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span>
                    <span className="font-semibold text-foreground">Why this matters: </span>
                    {review[q.id]?.explanation}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {!submitted ? (
          <div className="mt-10 pt-8 border-t border-border flex flex-col items-center gap-3">
            <Button 
              size="lg" 
              onClick={handleSubmit} 
              disabled={submitting || Object.keys(answers).length < questions.length}
              className="w-full sm:w-auto min-w-[240px] shadow-md"
            >
              {submitting ? 'Scoring…' : 'Submit Answers'}
            </Button>
            {submitError && (
              <p className="text-xs text-destructive" role="alert">
                {submitError}
              </p>
            )}
            <p className="text-xs text-muted-foreground font-medium">
              Answered {Object.keys(answers).length} of {questions.length} questions
            </p>
          </div>
        ) : (
          <div className="mt-10 pt-8 border-t border-border flex flex-col items-center gap-4 bg-destructive/5 rounded-xl p-6">
            <p className="text-destructive font-bold text-lg flex items-center gap-2">
              <AlertCircle className="size-5" />
              You scored {score}/{questions.length} — the pass mark is {passMark}/{questions.length}.
            </p>
            <p className="text-sm text-muted-foreground text-center">
              Review the preparation course, then try again. Answers are shown only after a pass.
            </p>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setAnswers({})
                setSubmitted(false)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="mt-2 w-full sm:w-auto min-w-[200px]"
            >
              Retake Assessment
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
