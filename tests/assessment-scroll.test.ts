import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The assessment navigator used to scroll to the top of the page for every question jump.
 *
 * The number grid sits below the header, the progress block and the navigator itself, so the
 * question card was pushed off-screen and the worker had to scroll back down after choosing a
 * number. The regression is easy to reintroduce because `scrollTo({ top: 0 })` looks harmless in
 * isolation; this test pins the contract instead of the pixels.
 */

const source = readFileSync(join(process.cwd(), 'components/assessment-quiz.tsx'), 'utf8')

test('choosing a question number keeps the question card in view', () => {
  assert.doesNotMatch(
    source,
    /window\.scrollTo\(\s*\{\s*top:\s*0/,
    'in-page navigation must not jump to the top of the document',
  )
  assert.match(source, /questionRef\.current\?\.scrollIntoView\(/, 'the navigator must scroll the question into view')
  assert.match(source, /ref=\{questionRef\}/, 'the question card must own the scroll target')
  assert.match(source, /scroll-mt-24/, 'the scroll target must clear the sticky header')
})

test('a retake returns to the start of the assessment, not the document top', () => {
  assert.match(source, /assessmentRef\.current\?\.scrollIntoView\(/, 'retake must bring the assessment panel back')
  assert.match(source, /ref=\{assessmentRef\}/)
})
