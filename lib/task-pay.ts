/**
 * Task pay — what one job card earns, how long it may take, and when money may leave.
 *
 * The platform's model, in its own words: assessments are *tasks* now, and a member does them to
 * earn. Each card prices an **hour** of that region's work, the task runs on a timer, and the amount
 * lands in the wallet when the task finishes. Nothing may be withdrawn until the member's balance
 * clears the withdrawal threshold, which is derived from the board itself: the sum of every card
 * price on their region's board, plus a small margin.
 *
 * Three rules live here, all pure, so the board, the route and the tests read the same numbers:
 *
 *  1. **Rate** — `taskRateUsd()` is `payForRegion()` for the card's own region. A card on the
 *     Americas board pays Americas prices; the region ceiling still applies. No new pricing rule.
 *  2. **Time → money** — `taskPayUsd()` multiplies the rate by the hours actually worked, bills a
 *     floor of one hour (a 20-minute task still pays its rate — that is what "price × hour" means
 *     to someone choosing work), and caps the billing at the timer's own length so a tab left open
 *     overnight cannot pay eight hours for a one-hour card.
 *  3. **The timer** — `taskTimerState()` decides whether a submission may be made at all. Before the
 *     timer has run out there is no submission: the server refuses it, rather than accepting a task
 *     finished in ninety seconds.
 *
 * The threshold does not live in config. It is `regionTaskTotalUsd()` of the member's board plus
 * `WITHDRAWAL_THRESHOLD_MARGIN_USD`, recomputed from the same card list the board renders, so the
 * number a member sees and the number the payout route enforces cannot drift apart.
 */

import { boardPayForRegion, type PayRegion, type RegionalPay } from '@/lib/pay-regions'

/** One card price buys this many minutes of work. "Prices × hour". */
export const TASK_PRICE_UNIT_MINUTES = 60

/** A task always pays at least one hour's rate, however quickly it is finished. */
export const TASK_MIN_BILLED_MINUTES = 60

/** The longest stretch of work one task can be paid for, whatever the tab was left doing. */
export const TASK_MAX_BILLED_MINUTES = 480

/** Used when a card carries no `estimatedMinutes`, so a timer always has a length. */
export const TASK_DEFAULT_TIMER_MINUTES = 60

/** The shortest timer accepted. Anything smaller is a typo, not a task. */
export const TASK_MIN_TIMER_MINUTES = 5

/**
 * How far above the board's total the withdrawal threshold sits.
 *
 * The platform asked for "more than that": the sum is the floor of the rule, and a member must clear
 * it rather than land exactly on it. One dollar is enough to make "more than" literally true without
 * inventing an amount nobody could explain.
 */
export const WITHDRAWAL_THRESHOLD_MARGIN_USD = 1

export type TaskCard = {
  payAmountUsd?: unknown
  payByRegion?: RegionalPay | null
  estimatedMinutes?: unknown
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function wholeNumber(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * How long this card's task runs.
 *
 * The card's `estimatedMinutes` is the author's statement of the work, so it becomes the timer.
 * Clamped at both ends: a zero or missing estimate gets an hour (never a zero-second timer, which
 * would make the timer meaningless), and an eight-hour ceiling stops one card from holding a task
 * open for a week.
 */
export function taskTimerMinutes(card: TaskCard | null | undefined): number {
  const written = wholeNumber(card?.estimatedMinutes)
  const minutes = written === null ? TASK_DEFAULT_TIMER_MINUTES : Math.round(written)
  return Math.min(TASK_MAX_BILLED_MINUTES, Math.max(TASK_MIN_TIMER_MINUTES, minutes))
}

/**
 * The card's hourly rate — its price, in its own region.
 *
 * Priced through `payForRegion`, so every existing rule holds: an explicit regional table wins, a
 * legacy scalar is capped by the region ceiling, and nothing can be priced above its board's band.
 */
export function taskRateUsd(card: TaskCard | null | undefined, region: PayRegion): number {
  if (!card) return 0
  return boardPayForRegion(
    {
      payAmountUsd: Number(card.payAmountUsd ?? 0) || 0,
      payByRegion: (card.payByRegion ?? null) as RegionalPay | null,
    },
    region,
  )
}

/**
 * Minutes actually billed: the time worked, floored at an hour, capped at the timer.
 *
 * The cap is the *greater* of the timer and the one-hour floor, not the timer alone. A 20-minute task
 * capped at its own 20 minutes would bill $4.67 at a $14 rate — the floor would exist in the code and
 * be unreachable for every short task, which is most of the board. Short work pays an hour; work that
 * runs longer pays for its own length, up to the timer.
 */
export function billedMinutes(elapsedMinutes: number, timerMinutes: number): number {
  const timer = Math.min(TASK_MAX_BILLED_MINUTES, Math.max(1, Math.round(timerMinutes || 0)))
  const worked = Number.isFinite(elapsedMinutes) ? Math.max(0, elapsedMinutes) : 0
  return Math.min(Math.max(timer, TASK_MIN_BILLED_MINUTES), Math.max(TASK_MIN_BILLED_MINUTES, worked))
}

/**
 * What a finished task pays: the rate × the hours billed.
 *
 * Rounded to cents once, at the end, so the figure credited is the figure the member was shown.
 * `rateUsd` of 0 stays 0 — an unpriced card must never invent money.
 */
export function taskPayUsd(input: {
  rateUsd: number
  timerMinutes: number
  elapsedSeconds: number
}): { payUsd: number; billedMinutes: number; rateUsd: number } {
  const rateUsd = round2(Math.max(0, Number(input.rateUsd) || 0))
  const minutes = billedMinutes((Number(input.elapsedSeconds) || 0) / 60, input.timerMinutes)
  if (rateUsd <= 0) return { payUsd: 0, billedMinutes: minutes, rateUsd: 0 }
  return { payUsd: round2((rateUsd * minutes) / TASK_PRICE_UNIT_MINUTES), billedMinutes: minutes, rateUsd }
}

export type TaskTimerState = {
  /** The timer's length in minutes. */
  timerMinutes: number
  /** Whole seconds since the task was started; 0 when it was never started. */
  elapsedSeconds: number
  /** Whole seconds still to run; 0 once the timer has passed. */
  remainingSeconds: number
  /** True when the timer has run out, i.e. the task may be finished. */
  complete: boolean
}

/**
 * The clock, as the server sees it.
 *
 * `startedAtMs` of `null` means the task was never started — the member opened the questions but no
 * timer exists, so nothing may be submitted. That is deliberate: the start is written server-side by
 * the route that hands out the questions, and a client cannot assert one.
 */
export function taskTimerState(input: {
  timerMinutes: number
  startedAtMs: number | null
  nowMs?: number
}): TaskTimerState {
  const timerMinutes = Math.min(TASK_MAX_BILLED_MINUTES, Math.max(TASK_MIN_TIMER_MINUTES, Math.round(input.timerMinutes || 0) || TASK_DEFAULT_TIMER_MINUTES))
  const now = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now()
  if (input.startedAtMs === null || !Number.isFinite(input.startedAtMs)) {
    return { timerMinutes, elapsedSeconds: 0, remainingSeconds: timerMinutes * 60, complete: false }
  }
  const elapsedSeconds = Math.max(0, Math.floor((now - input.startedAtMs) / 1000))
  const total = timerMinutes * 60
  return {
    timerMinutes,
    elapsedSeconds,
    remainingSeconds: Math.max(0, total - elapsedSeconds),
    complete: elapsedSeconds >= total,
  }
}

/** "12 min 05 s" — one phrasing, used by the server refusal and the client countdown. */
export function describeRemaining(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes <= 0) return `${rest} second${rest === 1 ? '' : 's'}`
  if (rest === 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  return `${minutes} min ${String(rest).padStart(2, '0')} s`
}

/**
 * Refuse a submission that arrives before the task's time has passed.
 *
 * The platform's rule is "when time passes the submission is never made" — until the timer runs out
 * there is nothing to submit. Returns `null` when the submission may proceed.
 */
export function taskSubmissionRefusal(state: TaskTimerState): string | null {
  if (state.complete) return null
  if (state.elapsedSeconds === 0 && state.remainingSeconds === state.timerMinutes * 60) {
    return 'This task has not been started yet, so there is nothing to submit. Open the task and its timer starts.'
  }
  return `This task still has ${describeRemaining(state.remainingSeconds)} to run. A task can only be submitted once its timer has finished.`
}

/**
 * The sum of every card price on one region's board.
 *
 * The number the platform asked for: "all the job cards prices combined". Cards are priced as the
 * board prices them, so this figure matches what the member can actually see and earn.
 */
export function regionTaskTotalUsd(cards: readonly TaskCard[], region: PayRegion): number {
  let total = 0
  for (const card of cards) total += taskRateUsd(card, region)
  return round2(total)
}

/**
 * The withdrawal threshold for a region: its board total plus the margin.
 *
 * `fallbackUsd` is used only when the board has no priced cards at all (an empty catalogue during a
 * first-run preview), so the rule never collapses to "withdraw anything".
 */
export function withdrawalThresholdUsd(
  cards: readonly TaskCard[],
  region: PayRegion,
  fallbackUsd = 0,
): { thresholdUsd: number; taskTotalUsd: number; marginUsd: number } {
  const taskTotalUsd = regionTaskTotalUsd(cards, region)
  if (taskTotalUsd <= 0) {
    const fallback = round2(Math.max(0, Number(fallbackUsd) || 0))
    return { thresholdUsd: fallback, taskTotalUsd: 0, marginUsd: 0 }
  }
  return {
    thresholdUsd: round2(taskTotalUsd + WITHDRAWAL_THRESHOLD_MARGIN_USD),
    taskTotalUsd,
    marginUsd: WITHDRAWAL_THRESHOLD_MARGIN_USD,
  }
}

/**
 * Where a member stands against the threshold.
 *
 * Kept separate from `validateWithdrawalAmount` so the banner ("$84.32 to go") and the refusal are
 * computed from one comparison.
 */
export function withdrawalProgress(input: {
  availableUsd: number
  heldUsd?: number
  thresholdUsd: number
}): { withdrawableUsd: number; met: boolean; shortfallUsd: number } {
  const available = round2(Math.max(0, Number(input.availableUsd) || 0))
  const held = round2(Math.max(0, Math.min(Number(input.heldUsd) || 0, available)))
  const withdrawableUsd = round2(Math.max(0, available - held))
  const thresholdUsd = round2(Math.max(0, Number(input.thresholdUsd) || 0))
  return {
    withdrawableUsd,
    met: withdrawableUsd >= thresholdUsd && withdrawableUsd > 0,
    shortfallUsd: round2(Math.max(0, thresholdUsd - withdrawableUsd)),
  }
}
