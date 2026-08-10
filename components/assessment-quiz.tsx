'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { JobCategory } from '@/lib/afterworks-data'
import { CheckCircle2, Circle, AlertCircle } from 'lucide-react'

// Generate 15 mock questions based on category
function generateQuestions(category: JobCategory) {
  const qs = []
  
  const categoryContext = {
    'Transcription': 'transcribing audio with varying accents and background noise',
    'Data Entry': 'extracting structured fields from scanned documents and receipts',
    'Image Labeling': 'drawing precise bounding boxes on objects in images',
    'Content Review': 'evaluating user-submitted text and images against safety policies',
    'Translation': 'translating context accurately without losing the original meaning',
    'Research': 'finding and verifying business contact details from web sources'
  }[category] || 'performing standard tasks according to the guidelines'

  for (let i = 1; i <= 15; i++) {
    qs.push({
      id: i,
      question: `Question ${i}: When ${categoryContext}, what is the most important rule to follow when encountering an ambiguous case?`,
      options: [
        'Flag it for review or use the designated "[unclear]" tag as per the guidelines.',
        'Guess the most likely answer to maintain speed.',
        'Skip the item entirely and leave the field blank without flagging.',
        'Use an automated tool to decide for you.'
      ],
      correctIndex: 0
    })
  }
  return qs
}

export function AssessmentQuiz({ category, onPass }: { category: JobCategory, onPass: () => void }) {
  const [questions] = useState(() => generateQuestions(category))
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [passed, setPassed] = useState(false)

  const handleSelect = (qId: number, oIdx: number) => {
    if (submitted) return
    setAnswers(prev => ({ ...prev, [qId]: oIdx }))
  }

  const handleSubmit = () => {
    let score = 0
    questions.forEach(q => {
      if (answers[q.id] === q.correctIndex) score++
    })
    
    setSubmitted(true)
    if (score >= 12) { // 80% to pass (12 out of 15)
      setPassed(true)
    }
  }

  if (passed) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 rounded-xl border border-success/30 bg-success/5">
        <CheckCircle2 className="size-16 text-success" />
        <h3 className="text-2xl font-bold text-success-foreground">Assessment Passed!</h3>
        <p className="text-muted-foreground text-center max-w-md">
          You have successfully demonstrated your skills for {category} tasks by scoring at least 80%.
        </p>
        <Button onClick={onPass} size="lg" className="mt-4 px-8">
          Proceed to Application
        </Button>
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
              Category: {category}
            </p>
          </div>
          <div className="flex items-center gap-2 bg-accent/50 px-3 py-1.5 rounded-lg text-sm font-medium">
            <AlertCircle className="size-4 text-primary" />
            <span>Pass mark: 12/15 (80%)</span>
          </div>
        </div>

        <div className="flex flex-col gap-10">
          {questions.map((q, i) => (
            <div key={q.id} className="flex flex-col gap-4">
              <p className="font-semibold text-base leading-relaxed text-foreground">
                <span className="text-muted-foreground mr-2">{i + 1}.</span>
                {q.question}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {q.options.map((opt, oIdx) => {
                  const isSelected = answers[q.id] === oIdx
                  const isCorrect = q.correctIndex === oIdx
                  
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
            </div>
          ))}
        </div>

        {!submitted ? (
          <div className="mt-10 pt-8 border-t border-border flex flex-col items-center gap-3">
            <Button 
              size="lg" 
              onClick={handleSubmit} 
              disabled={Object.keys(answers).length < questions.length}
              className="w-full sm:w-auto min-w-[240px] shadow-md"
            >
              Submit Answers
            </Button>
            <p className="text-xs text-muted-foreground font-medium">
              Answered {Object.keys(answers).length} of {questions.length} questions
            </p>
          </div>
        ) : (
          <div className="mt-10 pt-8 border-t border-border flex flex-col items-center gap-4 bg-destructive/5 rounded-xl p-6">
            <p className="text-destructive font-bold text-lg flex items-center gap-2">
              <AlertCircle className="size-5" />
              You did not meet the passing score.
            </p>
            <p className="text-sm text-muted-foreground text-center">
              Please review the training notes and guidelines, then try again.
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
