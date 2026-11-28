/**
 * Task pay — the money model, pinned.
 *
 * These tests exist because every number here leaves the building. The rules are: a card prices an
 * hour, a finished task pays rate × hours (floored at one hour, capped at the timer), nothing may be
 * submitted before the timer runs out, and nothing may be withdrawn until the member clears the sum
 * of their own board's card prices plus $1.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TASK_DEFAULT_TIMER_MINUTES,
  TASK_MAX_BILLED_MINUTES,
  TASK_MIN_BILLED_MINUTES,
  TASK_MIN_TIMER_MINUTES,
  WITHDRAWAL_THRESHOLD_MARGIN_USD,
  billedMinutes,
  describeRemaining,
  regionTaskTotalUsd,
  taskPayUsd,
  taskRateUsd,
  taskSubmissionRefusal,
  taskTimerMinutes,
  taskTimerState,
  withdrawalProgress,
  withdrawalThresholdUsd,
} from '@/lib/task-pay'
import { REGION_PAY_CEILING, PAY_REGIONS } from '@/lib/pay-regions'
import { seedRegionalJobs } from '@/lib/regional-jobs'
import { listingCards } from '@/lib/job-cards'
import type { JobRegion } from '@/lib/job-regions'

const ALL_CARDS = [...seedRegionalJobs(), ...listingCards()] as {
  region?: string
  payAmountUsd?: number
  estimatedMinutes?: number
}[]

function board(region: JobRegion) {
  return ALL_CARDS.filter((card) => card.region === region)
}

// ─── Rate ───────────────────────────────────────────────────────────────────

test('a card’s task rate is its price in its own region, and obeys the ceiling', () => {
  // Not a new pricing rule — the board's rule, reused, so the board and the payout cannot disagree.
  assert.equal(taskRateUsd({ payAmountUsd: 12 }, 'Africa'), 12)
  // A legacy scalar written for the Americas is still capped on the Africa board: paying $70 for a
  // task whose card says $70 is exactly the bug that put $70 cards on the Africa board.
  assert.equal(taskRateUsd({ payAmountUsd: 70 }, 'Africa'), REGION_PAY_CEILING.Africa)
  // An explicit per-region table wins over the scalar.
  assert.equal(taskRateUsd({ payAmountUsd: 70, payByRegion: { Africa: 9.5 } }, 'Africa'), 9.5)
  assert.equal(taskRateUsd(null, 'Africa'), 0, 'no card, no money')
  assert.equal(taskRateUsd({ payAmountUsd: 0 }, 'Africa'), 0, 'an unpriced card must not invent a rate')
})

test('every region’s board is priced within its own ceiling, card by card', () => {
  for (const region of PAY_REGIONS) {
    for (const card of board(region)) {
      const rate = taskRateUsd(card, region)
      assert.ok(rate > 0, `${region}: every card must pay something`)
      assert.ok(
        rate <= REGION_PAY_CEILING[region],
        `${region}: ${card.payAmountUsd} became a $${rate} rate, above the $${REGION_PAY_CEILING[region]} ceiling`,
      )
    }
  }
})

// ─── Time → money ───────────────────────────────────────────────────────────

test('a task pays its rate for an hour, and the price times the hours for longer', () => {
  // One hour at $14/hr is $14.
  assert.equal(taskPayUsd({ rateUsd: 14, timerMinutes: 60, elapsedSeconds: 3600 }).payUsd, 14)
  // Two hours at $14/hr is $28 — "the prices times the hour".
  assert.equal(taskPayUsd({ rateUsd: 14, timerMinutes: 120, elapsedSeconds: 7200 }).payUsd, 28)
  // Halfway through a two-hour task is one hour's pay, and no more: the floor is an hour.
  assert.equal(taskPayUsd({ rateUsd: 14, timerMinutes: 120, elapsedSeconds: 3600 }).payUsd, 14)
})

test('a short task still pays a full hour — the floor is the point of the model', () => {
  // 20 minutes at $14/hr would be $4.67 strictly prorated. The platform asked for "prices × hour",
  // and a member choosing between two cards must not be paid less for the faster one.
  const short = taskPayUsd({ rateUsd: 14, timerMinutes: 20, elapsedSeconds: 1200 })
  assert.equal(short.payUsd, 14)
  assert.equal(short.billedMinutes, TASK_MIN_BILLED_MINUTES)
})

test('a tab left open overnight cannot bill more than the timer, or more than eight hours', () => {
  const overnight = taskPayUsd({ rateUsd: 10, timerMinutes: 60, elapsedSeconds: 8 * 3600 })
  assert.equal(overnight.billedMinutes, 60, 'billing stops at the timer')
  assert.equal(overnight.payUsd, 10)

  const long = taskPayUsd({ rateUsd: 10, timerMinutes: 60 * 24, elapsedSeconds: 60 * 24 * 3600 })
  assert.equal(long.billedMinutes, TASK_MAX_BILLED_MINUTES, 'and at the eight-hour cap in any case')
})

test('billing rounds to cents once, so the credit is the figure shown', () => {
  const third = taskPayUsd({ rateUsd: 10, timerMinutes: 180, elapsedSeconds: 3 * 3600 })
  assert.equal(third.payUsd, 30)
  const odd = taskPayUsd({ rateUsd: 7.33, timerMinutes: 120, elapsedSeconds: 7200 })
  assert.equal(odd.payUsd, 14.66)
  assert.equal(Math.round(odd.payUsd * 100) / 100, odd.payUsd)
})

test('a zero rate pays zero, however long the task ran', () => {
  assert.equal(taskPayUsd({ rateUsd: 0, timerMinutes: 60, elapsedSeconds: 3600 }).payUsd, 0)
  assert.equal(taskPayUsd({ rateUsd: -5, timerMinutes: 60, elapsedSeconds: 3600 }).payUsd, 0)
  assert.equal(billedMinutes(3600, 60), 60, 'even a nonsense elapsed value is clamped')
})

// ─── The timer ──────────────────────────────────────────────────────────────

test('the timer comes from the card, clamped at both ends', () => {
  assert.equal(taskTimerMinutes({ estimatedMinutes: 180 }), 180)
  assert.equal(taskTimerMinutes({ estimatedMinutes: 0 }), TASK_DEFAULT_TIMER_MINUTES)
  assert.equal(taskTimerMinutes({}), TASK_DEFAULT_TIMER_MINUTES)
  assert.equal(taskTimerMinutes({ estimatedMinutes: 1 }), TASK_MIN_TIMER_MINUTES)
  assert.equal(taskTimerMinutes({ estimatedMinutes: 60 * 24 }), TASK_MAX_BILLED_MINUTES)
})

test('nothing may be submitted before the timer runs out', () => {
  const started = 1_000_000
  const running = taskTimerState({ timerMinutes: 30, startedAtMs: started, nowMs: started + 60_000 })
  assert.equal(running.complete, false)
  assert.equal(running.remainingSeconds, 29 * 60)
  const refusal = taskSubmissionRefusal(running)
  assert.ok(refusal, 'a half-finished timer is a refusal')
  assert.match(refusal!, /29 minutes/)
  assert.match(refusal!, /only be submitted once its timer has finished/)

  const done = taskTimerState({ timerMinutes: 30, startedAtMs: started, nowMs: started + 30 * 60_000 })
  assert.equal(done.complete, true)
  assert.equal(taskSubmissionRefusal(done), null, 'a finished timer is a green light')

  // One second early is early.
  const almost = taskTimerState({ timerMinutes: 30, startedAtMs: started, nowMs: started + 30 * 60_000 - 1000 })
  assert.equal(almost.complete, false)
})

test('a task that was never started has no clock and cannot be submitted', () => {
  const idle = taskTimerState({ timerMinutes: 60, startedAtMs: null })
  assert.equal(idle.complete, false)
  assert.equal(idle.elapsedSeconds, 0)
  const refusal = taskSubmissionRefusal(idle)
  assert.ok(refusal)
  assert.match(refusal!, /has not been started/)
})

test('remaining time is phrased the same way the client counts down', () => {
  assert.equal(describeRemaining(0), '0 seconds')
  assert.equal(describeRemaining(45), '45 seconds')
  assert.equal(describeRemaining(60), '1 minute')
  assert.equal(describeRemaining(125), '2 min 05 s')
})

// ─── The threshold ──────────────────────────────────────────────────────────

test('the Africa threshold is the sum of every card price on the Africa board, plus the margin', () => {
  const cards = board('Africa')
  assert.ok(cards.length >= 25, 'the Africa board is the full catalogue of its own cards')

  let manual = 0
  for (const card of cards) manual += taskRateUsd(card, 'Africa')
  manual = Math.round(manual * 100) / 100

  assert.equal(regionTaskTotalUsd(cards, 'Africa'), manual, 'one sum, computed one way')

  const { thresholdUsd, taskTotalUsd, marginUsd } = withdrawalThresholdUsd(cards, 'Africa')
  assert.equal(taskTotalUsd, manual)
  assert.equal(marginUsd, WITHDRAWAL_THRESHOLD_MARGIN_USD)
  assert.equal(thresholdUsd, Math.round((manual + WITHDRAWAL_THRESHOLD_MARGIN_USD) * 100) / 100)
  // "The withdrawable amount should be more than that": strictly above the board's total.
  assert.ok(thresholdUsd > manual, 'the threshold must sit above the board total, not on it')
})

test('each region’s threshold follows its own board, so the regions do not share a number', () => {
  const thresholds = PAY_REGIONS.map((region) => withdrawalThresholdUsd(board(region), region).thresholdUsd)
  assert.equal(new Set(thresholds).size, PAY_REGIONS.length, 'four boards, four thresholds')
  const africa = withdrawalThresholdUsd(board('Africa'), 'Africa').thresholdUsd
  const americas = withdrawalThresholdUsd(board('Americas'), 'Americas').thresholdUsd
  assert.ok(americas > africa, 'the Americas board sums higher than the Africa board')
})

test('an empty catalogue falls back rather than making withdrawal free', () => {
  const empty = withdrawalThresholdUsd([], 'Africa', 50)
  assert.equal(empty.taskTotalUsd, 0)
  assert.equal(empty.thresholdUsd, 50, 'no cards is a configuration gap, not a $0 threshold')
})

test('earnings below the threshold are not withdrawable, and the shortfall is exact', () => {
  const under = withdrawalProgress({ availableUsd: 100, thresholdUsd: 256.68 })
  assert.equal(under.met, false)
  assert.equal(under.withdrawableUsd, 100, 'the money is in the balance')
  assert.equal(under.shortfallUsd, 156.68)

  const exact = withdrawalProgress({ availableUsd: 256.68, thresholdUsd: 256.68 })
  assert.equal(exact.met, true, 'the threshold is inclusive once reached')
  assert.equal(exact.shortfallUsd, 0)

  // An open payout holds money, and the hold counts against the threshold: the member cannot reach
  // it a second time with money already claimed.
  const held = withdrawalProgress({ availableUsd: 300, heldUsd: 100, thresholdUsd: 256.68 })
  assert.equal(held.withdrawableUsd, 200)
  assert.equal(held.met, false)

  const nothing = withdrawalProgress({ availableUsd: 0, thresholdUsd: 0 })
  assert.equal(nothing.met, false, 'zero is never withdrawable, threshold or not')
})

// ─── The wallet boundary ────────────────────────────────────────────────────

test('the wallet quote zeroes the withdrawable figure under the threshold', async () => {
  const { withdrawalQuote, validateWithdrawalAmount } = await import('@/lib/payouts')
  const boards = withdrawalThresholdUsd(board('Africa'), 'Africa').thresholdUsd

  const saving = withdrawalQuote({ availableUsd: 120, minWithdrawalUsd: 50, withdrawalThresholdUsd: boards })
  assert.equal(saving.withdrawableUsd, 0, 'a balance under the threshold cannot be withdrawn')
  assert.equal(saving.clearedUsd, 120, 'but the money is still theirs, and still shown')
  assert.equal(saving.thresholdMet, false)
  assert.equal(saving.thresholdShortfallUsd, Math.round((boards - 120) * 100) / 100)

  const cleared = withdrawalQuote({ availableUsd: boards + 10, minWithdrawalUsd: 50, withdrawalThresholdUsd: boards })
  assert.equal(cleared.thresholdMet, true)
  assert.equal(cleared.withdrawableUsd, Math.round((boards + 10) * 100) / 100)

  // And the same guard the route uses refuses the amount the form can no longer produce.
  const refused = validateWithdrawalAmount(100, saving.withdrawableUsd, 50)
  assert.equal(refused.ok, false)
})

test('the payout route enforces the threshold before it looks at the amount', async () => {
  const { readFileSync } = await import('node:fs')
  const wallet = readFileSync('lib/wallet-server.ts', 'utf8')
  const submit = wallet.slice(wallet.indexOf('export async function submitPayoutRequest'))
  assert.match(submit, /resolveWithdrawalThreshold\(uid, data\)/, 'the hold path must use the same threshold')
  assert.match(submit, /below_withdrawal_threshold/, 'and refuse with a code the UI can explain')
  assert.ok(
    submit.indexOf('below_withdrawal_threshold') < submit.indexOf('validateWithdrawalAmount'),
    'the threshold is checked before the per-request minimum',
  )
  // The threshold comes from the board, computed, not from a config value.
  assert.match(wallet, /withdrawalThresholdUsd\(cards/)
  assert.match(wallet, /site\.minWithdrawalUsd/, 'with a configured fallback for an empty catalogue')
})

test('the member’s threshold is derived from their verified region, not the request', async () => {
  const { readFileSync } = await import('node:fs')
  const wallet = readFileSync('lib/wallet-server.ts', 'utf8')
  const fn = wallet.slice(wallet.indexOf('async function resolveWithdrawalThreshold'))
  assert.match(fn, /resolveWorkerRegion\(/)
  assert.match(fn, /verifiedCountry: data\.verifiedCountry/, 'verified country first — not the IP')
  assert.doesNotMatch(fn, /requestRegion|resolveRequestCountry/, 'a VPN must not lower the threshold')
})
