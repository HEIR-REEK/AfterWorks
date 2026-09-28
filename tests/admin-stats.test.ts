import assert from 'node:assert/strict'
import test from 'node:test'
import { normalisePlatformStats } from '@/lib/admin-domain'

/**
 * The console overview snapshot.
 *
 * `/admin` renders nested groups all the way down — `stats.money.availableUsd`,
 * `stats.security.lockouts.locked.length`, `stats.applications.underReview`. Optional chaining on
 * `stats` alone does not protect any of those: a payload that arrives but is missing one group
 * throws mid-render, and the error boundary replaces the console's front page. It is the same
 * failure as the member table reading `row.wallet.availableUsd` off a row with no wallet, so it is
 * fixed the same way — one projection at the boundary, and the page reads the result.
 */

// ─── Every group the page reads is present ───────────────────────────────────

test('a missing snapshot body still yields every group the overview renders', () => {
  for (const input of [undefined, null, {}, 'nope', [], 42]) {
    const stats = normalisePlatformStats(input)

    // Verbatim the expressions the page evaluates.
    assert.doesNotThrow(() => `${stats.money.availableUsd} ${stats.money.pendingUsd} ${stats.money.liabilityUsd}`)
    assert.doesNotThrow(() => stats.security.lockouts.locked.length)
    assert.doesNotThrow(() => stats.applications.underReview + stats.applications.active)
    assert.doesNotThrow(() => stats.totals.kycPending + stats.totals.suspended + stats.totals.users)
    assert.doesNotThrow(() => stats.jobs.open + stats.jobs.filledSlots + stats.jobs.totalSlots)
    assert.doesNotThrow(() => stats.payments.successful + stats.payments.last7dVolumeKes.toLocaleString())
    assert.doesNotThrow(() => stats.security.posture.filter((c) => c.severity !== 'pass').length)
    assert.doesNotThrow(() => stats.activity.length)
    assert.doesNotThrow(() => `${stats.maintenanceStatus.active} ${stats.maintenance.title}`)

    // `null` here means "Auth is not connected", which the page says out loud — not 0.
    assert.equal(stats.totals.accounts, null)
    assert.equal(stats.generatedAt.length > 0, true)
  }
})

test('a snapshot missing one group renders zeros, not a TypeError', () => {
  // `money` absent entirely: this is the payload that would have thrown on `money.availableUsd`.
  const stats = normalisePlatformStats({
    totals: { users: 12, kycPending: 3 },
    applications: { underReview: 5 },
  })

  assert.equal(stats.money.availableUsd, 0)
  assert.equal(stats.money.pendingUsd, 0)
  assert.equal(stats.money.revenueKes, 0)
  assert.equal(stats.totals.users, 12)
  assert.equal(stats.totals.kycPending, 3)
  assert.equal(stats.totals.suspended, 0)
  assert.equal(stats.applications.underReview, 5)
  assert.equal(stats.applications.active, 0)
})

test('balances are numbers, and a NaN or a string never reaches the JSX', () => {
  const stats = normalisePlatformStats({
    money: { availableUsd: Number.NaN, pendingUsd: '12.50', liabilityUsd: 30.005, revenueKes: null, paidOutKes: {} },
  })

  assert.equal(stats.money.availableUsd, 0)
  assert.equal(stats.money.pendingUsd, 12.5)
  assert.equal(stats.money.liabilityUsd, 30.005)
  assert.equal(stats.money.revenueKes, 0)
  assert.equal(stats.money.paidOutKes, 0)
})

// ─── The shapes that disagree with each other ────────────────────────────────

test("security.lockouts arrives as an object or a number, and only one of them has '.locked'", () => {
  // `PlatformStats` in lib/firestore-admin.ts types this as a number; /api/admin sends the snapshot
  // object. Both have been true at different times, so both have to survive.
  const asNumber = normalisePlatformStats({ security: { failedLogins24h: 4, lockouts: 2 } })
  assert.deepEqual(asNumber.security.lockouts.locked, [])
  assert.equal(asNumber.security.failedLogins24h, 4)

  const asObject = normalisePlatformStats({
    security: {
      lockouts: { tracked: 3, totalAttempts: 11, totalBlocked: 2, locked: [{ key: 'ip:10.0.0.1', until: 1_800_000_000_000 }, 'junk'] },
    },
  })
  assert.equal(asObject.security.lockouts.tracked, 3)
  assert.equal(asObject.security.lockouts.totalBlocked, 2)
  assert.deepEqual(asObject.security.lockouts.locked, [{ key: 'ip:10.0.0.1', until: 1_800_000_000_000 }, { key: '', until: 0 }])
})

test('posture checks are coerced, because the page keys and colours by them', () => {
  const stats = normalisePlatformStats({
    security: {
      posture: [
        { id: 'a', label: 'Rules deployed', severity: 'pass', detail: 'ok' },
        { id: 'b', label: 'Admin roster', severity: 'nonsense', detail: 'check ADMIN_EMAILS', fix: 'set it' },
        {},
      ],
    },
  })

  assert.equal(stats.security.posture[0].severity, 'pass')
  assert.equal(stats.security.posture[1].severity, 'warn') // unknown severity is a warning, never a silent pass
  assert.equal(stats.security.posture[1].fix, 'set it')
  assert.equal(stats.security.posture[2].id, 'check-2') // a stable React key even when the row has none
  assert.equal(stats.security.posture[2].label, 'Configuration check')
  assert.equal('fix' in stats.security.posture[0], false)
})

test('the activity ticker keeps a key and a printable label for every row', () => {
  const stats = normalisePlatformStats({
    activity: [{ id: 'log-1', label: 'Approved application', at: '2026-03-01T08:30:00.000Z', tone: 'success' }, {}, 'junk'],
  })

  assert.equal(stats.activity.length, 3)
  assert.equal(stats.activity[0].at, '2026-03-01T08:30:00.000Z')
  assert.equal(stats.activity[1].id, 'activity-1')
  assert.equal(stats.activity[1].label, 'Console action')
  assert.equal(stats.activity[1].at, '')
})

test('the maintenance banner reads as text even when the window has no ETA', () => {
  const live = normalisePlatformStats({
    maintenance: { enabled: true, mode: 'blackout', title: 'Upgrading payouts', estimatedEnd: '2026-03-01T09:00:00.000Z', updatedBy: 'owner@example.com' },
    maintenanceStatus: { active: true, bannerOnly: false, retryAfterSec: 600, remainingMs: 3_600_000 },
  })
  assert.equal(live.maintenanceStatus.active, true)
  assert.equal(live.maintenance.title, 'Upgrading payouts')
  assert.equal(live.maintenance.estimatedEnd, '2026-03-01T09:00:00.000Z')
  assert.equal(live.maintenance.updatedBy, 'owner@example.com')
  assert.equal(live.maintenanceStatus.remainingMs, 3_600_000)

  const quiet = normalisePlatformStats({ maintenance: { enabled: false }, maintenanceStatus: {} })
  assert.equal(quiet.maintenanceStatus.active, false)
  assert.equal(quiet.maintenance.title, 'Maintenance')
  assert.equal(quiet.maintenance.estimatedEnd, null)
  assert.equal(quiet.maintenanceStatus.remainingMs, null)
  assert.equal('updatedBy' in quiet.maintenance, false)
})

// ─── The browser boundary ────────────────────────────────────────────────────

test('adminApi.stats() hands the page a snapshot it cannot crash on', async () => {
  const { adminApi } = await import('@/lib/admin')
  const originalFetch = globalThis.fetch
  // A response that is present but incomplete: no money group, lockouts as a bare number.
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        totals: { users: 8, accounts: 9 },
        jobs: { open: 2 },
        applications: { underReview: 1 },
        payments: { successful: 4, last7dVolumeKes: 12_500 },
        security: { failedLogins24h: 1, lockouts: 0, posture: [] },
        activity: [],
        maintenance: { enabled: false },
        maintenanceStatus: { active: false, bannerOnly: false, retryAfterSec: 0, remainingMs: null },
        generatedAt: '2026-03-01T08:30:00.000Z',
        cached: true,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch

  try {
    const stats = await adminApi.stats(true)

    // The line from the console overview, evaluated verbatim.
    assert.equal(stats.money.availableUsd, 0)
    assert.equal(stats.money.pendingUsd, 0)
    assert.equal(stats.totals.accounts, 9)
    assert.equal(stats.totals.users, 8)
    assert.equal(stats.jobs.paused, 0)
    assert.equal(stats.jobs.totalSlots, 0)
    assert.equal(stats.payments.last7dVolumeKes, 12_500)
    assert.deepEqual(stats.security.lockouts.locked, [])
    assert.deepEqual(stats.security.posture, [])
    assert.equal(stats.generatedAt, '2026-03-01T08:30:00.000Z')
  } finally {
    globalThis.fetch = originalFetch
  }
})
