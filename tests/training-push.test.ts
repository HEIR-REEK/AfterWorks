import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The higher-pay message is a conversion surface, not decoration: if it disappears from the landing
 * page or the dashboard, or its CTA stops pointing at the filtered board, the feature is silently
 * gone. These assertions are intentionally about the wiring, not the pixels.
 */

const ROOT = process.cwd()
const landing = readFileSync(join(ROOT, 'app/page.tsx'), 'utf8')
const dashboard = readFileSync(join(ROOT, 'app/dashboard/page.tsx'), 'utf8')
const jobs = readFileSync(join(ROOT, 'app/jobs/page.tsx'), 'utf8')
const component = readFileSync(join(ROOT, 'components/training-push.tsx'), 'utf8')

test('the landing page carries the training → higher-pay section and a hero link to it', () => {
  assert.match(landing, /TrainingPushSection/)
  assert.match(component, /id="training"/, 'the training section needs an anchor')
  assert.match(landing, /Get trained for higher-paying jobs/, 'the hero pill is the eye-catcher')
  assert.match(component, /Get trained\. Get the higher-paying jobs\./)
})

test('the dashboard surfaces the training banner with live board numbers', () => {
  assert.match(dashboard, /TrainingPushBanner/)
  assert.match(dashboard, /trainingJobs\.length/, 'the banner must use the live training-job count')
  assert.match(dashboard, /topTrainingPay/, 'the banner must use the live top training pay')
})

test('the training CTA lands on a board that can actually filter for training jobs', () => {
  assert.match(component, /\/jobs\?training=1/)
  assert.match(jobs, /searchParams\.get\('training'\) === '1'/)
  assert.match(jobs, /trainingOnly && !job\.trainingRequired/)
})
