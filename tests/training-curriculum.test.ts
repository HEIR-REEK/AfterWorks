import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  BUILT_IN_QUESTION_COUNT,
  JOB_CATEGORY_LIST,
  safeImageSrc,
  TRAINING_LESSON_KINDS,
  type Job,
} from '@/lib/afterworks-data'
import { getBuiltInTrainingCourse, getJobTrainingCourse } from '@/lib/training-curriculum'
import { normaliseAssessmentQuestions, normaliseTrainingSections } from '@/lib/job-catalogue'
import { builtInQuestions, publicAssessmentQuestions } from '@/lib/assessment-bank'
import { sanitizeJob } from '@/lib/firestore-admin'

const ROOT = process.cwd()

function localFigure(value: string): string | null {
  if (!value.startsWith('/')) return null
  return join(ROOT, 'public', value.replace(/^\//, ''))
}

test('every work category has a full built-in coursebook with units, labs and a glossary', () => {
  for (const category of JOB_CATEGORY_LIST) {
    const course = getBuiltInTrainingCourse(category)
    assert.equal(course.modules.length, 12, `${category} should be a twelve-lesson coursebook`)
    assert.ok(course.objectives.length >= 3, `${category} needs learning objectives`)
    assert.ok(course.heroImage, `${category} needs a course hero figure`)
    assert.ok(course.heroAlt && course.heroAlt.length > 20, `${category} hero needs alt text`)

    const units = new Set(course.modules.map((section) => section.unit).filter(Boolean))
    assert.ok(units.size >= 5, `${category} needs at least five units, got ${units.size}`)
    const kinds = new Set(course.modules.map((section) => section.kind).filter(Boolean))
    for (const kind of kinds) {
      assert.ok(TRAINING_LESSON_KINDS.includes(kind!), `${category} uses an unknown lesson kind: ${kind}`)
    }
    assert.ok(kinds.has('lab'), `${category} needs a capstone lab`)
    assert.ok(kinds.has('checkpoint'), `${category} needs an assessment-readiness checkpoint`)
    assert.ok(kinds.has('scenario'), `${category} needs applied scenario lessons`)

    for (const section of course.modules) {
      assert.ok(section.title.trim().length > 4, `${category} has an untitled lesson`)
      assert.ok(section.content.trim().length > 400, `${category} / ${section.title} is too thin`)
      assert.ok((section.durationMinutes ?? 0) >= 1, `${category} / ${section.title} has no duration`)
      assert.ok(section.unit, `${category} / ${section.title} has no unit`)
      assert.ok(section.kind, `${category} / ${section.title} has no lesson kind`)
      if (section.image) {
        const path = localFigure(section.image)
        assert.ok(path && existsSync(path), `${category} figure is missing: ${section.image}`)
        assert.ok(section.imageAlt && section.imageAlt.length > 20, `${category} figure needs alt text`)
      }
      if (section.check?.image) {
        const path = localFigure(section.check.image)
        assert.ok(path && existsSync(path), `${category} check figure is missing: ${section.check.image}`)
        assert.ok(section.check.imageAlt, `${category} / ${section.title} check figure needs alt text`)
      }
    }
    assert.ok(
      course.modules.filter((section) => section.check).length >= 6,
      `${category} needs knowledge checks in at least half the lessons`,
    )
    assert.ok(
      course.modules.filter((section) => section.objective).length >= 6,
      `${category} lessons should state a measurable objective`,
    )
    assert.ok((course.glossary?.length ?? 0) >= 4, `${category} needs a course glossary`)
    for (const entry of course.glossary ?? []) {
      assert.ok(entry.term.trim() && entry.definition.trim().length > 20, `${category} has a thin glossary entry`)
    }
  }
})

test('every built-in course figure resolves to a shipped public file', () => {
  for (const category of JOB_CATEGORY_LIST) {
    const course = getBuiltInTrainingCourse(category)
    const figures = [
      course.heroImage,
      ...course.modules.map((section) => section.image),
      ...course.modules.map((section) => section.check?.image),
    ].filter((value): value is string => Boolean(value))
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
      durationMinutes: 7,
      check: {
        question: 'Which total is copied?',
        options: ['The line-item sum', 'The printed total'],
        correctIndex: 1,
        explanation: 'The source document is the authority.',
      },
    },
    {
      title: 'Unsafe',
      content: 'No figure.',
      image: 'javascript:alert(1)',
      check: { question: 'Half-written', options: ['Only one'], correctIndex: 0 },
    },
  ])
  assert.equal(sections[0]!.image, '/training/data-entry-receipt.svg')
  assert.equal(sections[0]!.imageAlt, 'A receipt with a printed total')
  assert.equal(sections[0]!.imageCaption, 'The printed total wins.')
  assert.equal(sections[0]!.durationMinutes, 7)
  assert.equal(sections[0]!.check?.question, 'Which total is copied?')
  assert.deepEqual(sections[0]!.check?.options, ['The line-item sum', 'The printed total'])
  assert.equal(sections[0]!.check?.correctIndex, 1)
  assert.equal(sections[1]!.image, undefined)
  // A check with fewer than two options is not answerable, so the reader never sees it.
  assert.equal(sections[1]!.check, undefined)

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
        unit: 'Unit 1 · Foundations',
        kind: 'scenario',
        objective: 'Decide where a speaker change starts a new line.',
        image: '/training/transcription-quality.svg',
        imageAlt: 'A transcript example',
        imageCaption: 'Pass versus fix.',
        durationMinutes: 6,
        check: {
          question: 'What starts a new line?',
          options: ['A speaker change', 'A comma'],
          correctIndex: 0,
          explanation: 'A speaker change starts a new line.',
          image: '/training/transcription-capstone.svg',
          imageAlt: 'A transcript with a speaker map and a dropout tag',
        },
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
  assert.equal(saved.trainingNotes[0]!.unit, 'Unit 1 · Foundations')
  assert.equal(saved.trainingNotes[0]!.kind, 'scenario')
  assert.equal(saved.trainingNotes[0]!.objective, 'Decide where a speaker change starts a new line.')
  assert.equal(saved.trainingNotes[0]!.check?.image, '/training/transcription-capstone.svg')
  assert.equal(saved.trainingNotes[0]!.image, '/training/transcription-quality.svg')
  assert.equal(saved.trainingNotes[0]!.imageAlt, 'A transcript example')
  assert.equal(saved.trainingNotes[0]!.imageCaption, 'Pass versus fix.')
  assert.equal(saved.trainingNotes[0]!.durationMinutes, 6)
  assert.equal(saved.trainingNotes[0]!.check?.question, 'What starts a new line?')
  assert.equal(saved.trainingNotes[0]!.check?.correctIndex, 0)
  assert.equal(saved.trainingNotes[1]!.image, undefined)
  assert.equal(saved.assessmentQuestions[0]!.image, '/training/transcription-quality.svg')
  assert.equal(saved.assessmentQuestions[0]!.explanation, 'The speaker change starts a new line.')
})

test('every category has a 25-question built-in assessment with figures and explanations', () => {
  for (const category of JOB_CATEGORY_LIST) {
    const questions = builtInQuestions(category)
    assert.equal(questions.length, BUILT_IN_QUESTION_COUNT, `${category} should ship ${BUILT_IN_QUESTION_COUNT} questions`)
    assert.equal(BUILT_IN_QUESTION_COUNT, 25)
    assert.deepEqual(
      questions.map((question) => question.id),
      Array.from({ length: BUILT_IN_QUESTION_COUNT }, (_, index) => index + 1),
      `${category} question ids should be stable and unique`,
    )
    for (const question of questions) {
      assert.ok(question.question.trim().length > 20, `${category} has a thin question`)
      assert.ok(question.options.length >= 2, `${category} / ${question.question} needs options`)
      assert.ok(question.correctIndex >= 0 && question.correctIndex < question.options.length)
      if (question.image) {
        const path = localFigure(question.image)
        assert.ok(path && existsSync(path), `${category} assessment figure does not exist: ${question.image}`)
        assert.ok(question.imageAlt && question.imageAlt.length > 20, `${category} question figure needs alt text`)
      }
      if (question.explanation) {
        assert.ok(question.explanation.length > 30, `${category} explanation is too thin`)
      }
    }
    const figures = questions.filter((question) => question.image)
    assert.ok(figures.length >= 2, `${category} should carry at least two question figures`)

    // The public projection is what the browser receives: no key, no explanation.
    const publicQuestions = publicAssessmentQuestions(questions)
    assert.equal(publicQuestions.length, questions.length)
    for (const question of publicQuestions) {
      assert.equal('correctIndex' in question, false, `${category} leaked the answer key`)
      assert.equal('explanation' in question, false, `${category} leaked the explanation`)
    }
  }
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
  assert.ok(builtIn.modules.length >= 12)
})
