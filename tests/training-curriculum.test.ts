import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  JOB_CATEGORY_LIST,
  safeImageSrc,
  type Job,
} from '@/lib/afterworks-data'
import { getBuiltInTrainingCourse, getJobTrainingCourse } from '@/lib/training-curriculum'
import { normaliseAssessmentQuestions, normaliseTrainingSections } from '@/lib/job-catalogue'
import { sanitizeJob } from '@/lib/firestore-admin'

const ROOT = process.cwd()

function localFigure(value: string): string | null {
  if (!value.startsWith('/')) return null
  return join(ROOT, 'public', value.replace(/^\//, ''))
}

test('every work category has a full built-in course, not four text blobs', () => {
  for (const category of JOB_CATEGORY_LIST) {
    const course = getBuiltInTrainingCourse(category)
    assert.ok(course.objectives.length >= 3, `${category} needs learning objectives`)
    assert.ok(course.modules.length >= 5, `${category} needs at least five lessons`)
    assert.ok(course.heroImage, `${category} needs a course hero figure`)
    assert.ok(course.heroAlt && course.heroAlt.length > 20, `${category} hero needs alt text`)
    for (const section of course.modules) {
      assert.ok(section.title.trim().length > 4, `${category} has an untitled lesson`)
      assert.ok(section.content.trim().length > 400, `${category} / ${section.title} is too thin`)
      assert.ok((section.durationMinutes ?? 0) >= 1, `${category} / ${section.title} has no duration`)
      if (section.image) {
        const path = localFigure(section.image)
        assert.ok(path && existsSync(path), `${category} figure is missing: ${section.image}`)
        assert.ok(section.imageAlt && section.imageAlt.length > 20, `${category} figure needs alt text`)
      }
    }
    assert.ok(
      course.modules.filter((section) => section.check).length >= 4,
      `${category} needs knowledge checks in most lessons`,
    )
  }
})

test('every built-in course figure resolves to a shipped public file', () => {
  for (const category of JOB_CATEGORY_LIST) {
    const course = getBuiltInTrainingCourse(category)
    const figures = [course.heroImage, ...course.modules.map((section) => section.image)].filter(
      (value): value is string => Boolean(value),
    )
    for (const figure of figures) {
      const path = localFigure(figure)
      assert.ok(path && existsSync(path), `${category} figure does not exist: ${figure}`)
    }
  }
})

test('only same-origin paths and plain https URLs are accepted as authored figures', () => {
  assert.equal(safeImageSrc('/training/transcription-quality.svg'), '/training/transcription-quality.svg')
  assert.equal(safeImageSrc('https://example.com/figure.png'), 'https://example.com/figure.png')
  assert.equal(safeImageSrc('http://example.com/figure.png'), undefined)
  assert.equal(safeImageSrc('//evil.example/figure.png'), undefined)
  assert.equal(safeImageSrc('javascript:alert(1)'), undefined)
  assert.equal(safeImageSrc('data:image/svg+xml,<svg/>'), undefined)
  assert.equal(safeImageSrc(''), undefined)
})

test('authored training figures and explanations survive normalisation, and unsafe URLs are dropped', () => {
  const sections = normaliseTrainingSections([
    {
      title: 'Reading a receipt',
      content: 'Copy the printed total.',
      image: '/training/data-entry-receipt.svg',
      imageAlt: 'A receipt with a printed total',
      imageCaption: 'The printed total wins.',
    },
    { title: 'Unsafe', content: 'No figure.', image: 'javascript:alert(1)' },
  ])
  assert.equal(sections[0]!.image, '/training/data-entry-receipt.svg')
  assert.equal(sections[0]!.imageAlt, 'A receipt with a printed total')
  assert.equal(sections[0]!.imageCaption, 'The printed total wins.')
  assert.equal(sections[1]!.image, undefined)

  const questions = normaliseAssessmentQuestions([
    {
      question: 'Where does the total come from?',
      options: ['The line items', 'The printed total'],
      correctIndex: 1,
      image: '/training/data-entry-receipt.svg',
      imageAlt: 'Receipt total',
      explanation: 'The source document is the authority.',
    },
  ])
  assert.equal(questions[0]!.image, '/training/data-entry-receipt.svg')
  assert.equal(questions[0]!.imageAlt, 'Receipt total')
  assert.equal(questions[0]!.explanation, 'The source document is the authority.')
})

test('the admin write path keeps safe figures and explanations, and drops unsafe ones', () => {
  const saved = sanitizeJob({
    title: 'Test card',
    category: 'Transcription',
    description: 'A test.',
    responsibilities: [],
    payAmountUsd: 40,
    estimatedMinutes: 60,
    capacity: 5,
    trainingRequired: true,
    requiresVerified: true,
    status: 'open',
    trainingNotes: [
      {
        title: 'A lesson',
        content: 'Look at the figure.',
        image: '/training/transcription-quality.svg',
        imageAlt: 'A transcript example',
        imageCaption: 'Pass versus fix.',
      },
      { title: 'Unsafe', content: 'No figure.', image: 'javascript:alert(1)' },
    ],
    assessmentQuestions: [
      {
        question: 'Which line is correct?',
        options: ['A', 'B'],
        correctIndex: 0,
        image: '/training/transcription-quality.svg',
        explanation: 'The speaker change starts a new line.',
      },
    ],
  })
  assert.equal(saved.trainingNotes[0]!.image, '/training/transcription-quality.svg')
  assert.equal(saved.trainingNotes[0]!.imageAlt, 'A transcript example')
  assert.equal(saved.trainingNotes[0]!.imageCaption, 'Pass versus fix.')
  assert.equal(saved.trainingNotes[1]!.image, undefined)
  assert.equal(saved.assessmentQuestions[0]!.image, '/training/transcription-quality.svg')
  assert.equal(saved.assessmentQuestions[0]!.explanation, 'The speaker change starts a new line.')
})

test('the built-in assessment carries figures and explanations that match the course', () => {
  const quiz = readFileSync(join(ROOT, 'components/assessment-quiz.tsx'), 'utf8')
  const figures = [...quiz.matchAll(/img:\s*'(\/training\/[^']+)'/g)].map((match) => match[1]!)
  assert.ok(figures.length >= 6, 'each category should have at least one question figure')
  for (const figure of figures) {
    const path = localFigure(figure)
    assert.ok(path && existsSync(path), `assessment figure does not exist: ${figure}`)
  }
  assert.match(quiz, /why:/, 'image questions need an explanation')
})

test('a job with authored notes gets a job-specific course; an empty one gets the category course', () => {
  const base: Job = {
    id: 'job-test',
    title: 'Test card',
    category: 'Transcription',
    description: 'Transcribe short customer calls.',
    responsibilities: [],
    payAmountUsd: 50,
    estimatedMinutes: 60,
    capacity: 10,
    slotsRemaining: 10,
    trainingRequired: true,
    requiresVerified: true,
    status: 'open',
    closesAt: new Date(0).toISOString(),
    postedAgo: 'just now',
  }

  const authored = getJobTrainingCourse({
    ...base,
    trainingNotes: [{ title: 'The client brief', content: 'Use the client glossary.' }],
  })
  assert.ok(authored.modules.length >= 6, 'a short brief is added to the category course')
  assert.equal(authored.modules[0]!.title, 'The client brief')
  assert.ok(authored.level.includes('job-specific'))
  assert.ok((authored.modules[0]!.durationMinutes ?? 0) >= 3)

  const builtIn = getJobTrainingCourse(base)
  assert.equal(builtIn.modules.length, getBuiltInTrainingCourse('Transcription').modules.length)
  assert.ok(builtIn.modules.length >= 5)
})
