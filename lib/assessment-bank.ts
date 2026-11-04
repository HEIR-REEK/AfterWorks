/**
 * The built-in assessment bank.
 *
 * This module is server-only on purpose. The previous copy lived in
 * `components/assessment-quiz.tsx`, so every browser downloaded `correctIndex` for every question
 * before it had answered anything. The scoring route imports this file; the browser receives only
 * `publicAssessmentQuestions()` (question, options and figure).
 */
import { safeImageSrc, type JobCategory } from '@/lib/afterworks-data'
import { EXTRA_BANKS } from '@/lib/assessment-bank-extra'
import { EXPERT_BANKS } from '@/lib/assessment-bank-expert'

export type BankQuestion = {
  id: number
  question: string
  options: string[]
  correctIndex: number
  image?: string
  imageAlt?: string
  explanation?: string
}

/** The public projection — deliberately drops the answer and the explanation. */
export type PublicAssessmentQuestion = Omit<BankQuestion, 'correctIndex' | 'explanation'>

export function publicAssessmentQuestions(questions: BankQuestion[]): PublicAssessmentQuestion[] {
  return questions.map(({ id, question, options, image, imageAlt }) => ({
    id,
    question,
    options,
    ...(image ? { image } : {}),
    ...(imageAlt ? { imageAlt } : {}),
  }))
}

export function builtInQuestions(category: JobCategory): BankQuestion[] {
  // The served assessment is the advanced tier plus the expert tier: ten applied scenarios each,
  // twenty questions per category. The older recognition bank was removed rather than mixed in,
  // because a worker could clear it from vocabulary alone and the pass mark is 80%.
  //
  // There is deliberately no generic fallback: if a category has no authored hard items, the
  // caller gets an empty bank and the API refuses the assessment instead of quietly serving an
  // easy quiz. A missing bank is a content bug, not a pass.
  const advancedQuestions = EXTRA_BANKS[category as string] ?? []
  const expertQuestions = EXPERT_BANKS[category as string] ?? []
  const rawQuestions = [...advancedQuestions, ...expertQuestions]

  return rawQuestions.map((rq, idx) => ({
    id: idx + 1,
    question: rq.q,
    options: rq.opts,
    correctIndex: rq.ans,
    ...(safeImageSrc(rq.img) ? { image: safeImageSrc(rq.img) } : {}),
    ...(rq.alt ? { imageAlt: rq.alt } : {}),
    ...(rq.why ? { explanation: rq.why } : {}),
  }))
}
