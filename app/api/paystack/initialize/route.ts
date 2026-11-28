import { NextRequest } from 'next/server'
import { consumeBucket, audit, fail, json, maintenanceBlockForApi, requireUser, routeError } from '@/lib/guards'
import { env, envInt, isHostAllowed, readJsonBody, sanitizeLine } from '@/lib/security-core'
import { paystackSubunitsFor, trainingFeeKesFor, trainingFeeUsdFor } from '@/lib/afterworks-data'
import { priceAccessFeeUsd, PRICE_ACCESS_PURPOSE } from '@/lib/price-access'
import type { PayRegion } from '@/lib/pay-regions'
import { randomId } from '@/lib/session-token'
import { loadJobCard, requestRegion, requestUnlockedRegions } from '@/lib/job-region-gate'

export const dynamic = 'force-dynamic'

/**
 * Hosts a browser can never reach: the app's *bind* address and loopback. Paystack redirects the
 * payer's browser to the callback URL, so handing it `https://0.0.0.0:10000/…` (what `Host` looks
 * like behind a port-forwarding preview tunnel) sends the worker to a page that says "site not
 * reachable" the moment the payment succeeds.
 */
const BIND_OR_LOOPBACK_HOST = /^(localhost|127(\.\d+){1,3}|\[::1\]|0\.0\.0\.0)(:\d+)?$/i

/**
 * The public origin Paystack should send the payer back to after the charge settles.
 *
 * Resolution order: the deployment's configured public URL, then trusted forwarded host/proto
 * headers, then the request Host — skipping any candidate that is a bind/loopback address. When
 * nothing usable exists (a bare preview tunnel with no APP_URL), `popupMode` is returned instead:
 * the checkout then opens Paystack in a new tab while the training page stays open and confirms
 * the charge itself, so a successful payment never ends in an unreachable redirect.
 */
function browserReachableOrigin(req: NextRequest): { origin: string; popupMode: boolean } {
  const configured = env('NEXT_PUBLIC_APP_URL') || env('APP_URL') || env('RENDER_EXTERNAL_URL') || env('VERCEL_URL')
  if (configured) {
    try {
      const url = new URL(configured.startsWith('http') ? configured : `https://${configured}`)
      if (url.hostname && !BIND_OR_LOOPBACK_HOST.test(url.host)) return { origin: url.origin.replace(/\/+$/, ''), popupMode: false }
    } catch {
      /* malformed config — fall through to the request headers */
    }
  }

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const forwardedHost = req.headers.get('x-forwarded-host')?.trim().replace(/\/+$/, '')
  const hostHeader = req.headers.get('host')?.trim().replace(/\/+$/, '')
  for (const host of [forwardedHost, hostHeader]) {
    if (!host || BIND_OR_LOOPBACK_HOST.test(host)) continue
    if (!isHostAllowed(host)) continue
    const scheme = forwardedProto === 'http' ? 'http' : 'https'
    return { origin: `${scheme}://${host}`, popupMode: false }
  }

  // Last resort: Next's own reconstruction of the origin. Still refuse bind/loopback addresses.
  try {
    const url = new URL(req.nextUrl.origin)
    if (url.hostname && !BIND_OR_LOOPBACK_HOST.test(url.host)) return { origin: url.origin.replace(/\/+$/, ''), popupMode: false }
  } catch {
    /* no usable origin */
  }
  return { origin: '', popupMode: true }
}

/**
 * POST /api/paystack/initialize — buy access to one region's job prices.
 *
 * The previous version took `amount`, `email` and `metadata` from the request body and passed them
 * straight to Paystack. Anyone could therefore buy a KES 13,000 training for KES 10, or start a
 * charge against somebody else's address. The route was also unused by the UI, which instead asked
 * `react-paystack` to build the transaction in the browser — the same problem, one layer earlier.
 *
 * Now: the amount is derived from server config, the payer email is the authenticated user's, the
 * reference is minted here so it can be reconciled, and the pending row is written from the server.
 *
 * What the charge buys changed with the price-access rule: not a training place on one card, but the
 * right to work one **region's price tier**. The body says which region (`priceRegion`); the price is
 * computed here from that tier, capped by its own ceiling; the reference is stamped with the region,
 * so verifying it later unlocks exactly that region and nothing else. The training modules are
 * untouched — this route no longer sells them.
 */

export async function POST(req: NextRequest) {
  const maintenance = await maintenanceBlockForApi(req)
  if (maintenance) return maintenance

  // Deliberately `requireUser`, not `requireVerifiedUser`. A member may pay a training fee before
  // their identity is checked — the checkout is what funds the card, and verification gates the
  // training material and the assessment afterwards. Requiring verification here refused the very
  // payment the training page invites, and the UI told members the opposite.
  const guard = await requireUser(req)
  if (!guard.ok) return guard.response
  const { uid, email } = guard.value

  if (!email) return fail(400, 'Add an email address to your profile before paying.', { code: 'email_required' })

  const bucket = consumeBucket('paystack-init', envInt('PAYSTACK_INIT_RATE_PER_MINUTE', 6), 60_000, uid)
  if (!bucket.ok) {
    return fail(429, 'Too many checkout requests. Please wait a moment.', { code: 'rate_limited', headers: { 'Retry-After': String(bucket.retryAfterSec) } })
  }

  const secretKey = env('PAYSTACK_SECRET_KEY')
  if (!secretKey) {
    return fail(503, 'Card and mobile-money checkout is not configured on this deployment.', { code: 'paystack_unconfigured' })
  }

  const parsed = await readJsonBody<Record<string, unknown>>(req, 8_000)
  if (!parsed.ok) return fail(400, parsed.error, { code: 'bad_request' })
  // Two shapes are accepted. `priceRegion` is the new one — the region whose prices are being
  // unlocked. `jobId` is kept for older clients and resolves to that card's own region, so a checkout
  // opened from a card page still buys the right tier.
  const requestedRegion = sanitizeLine(parsed.data.priceRegion, 20)
  const jobId = sanitizeLine(parsed.data.jobId, 80)
  // The card the member was reading, when the checkout was opened from one. It does not bind the
  // charge (the region does), but it is where the payer is sent back to, so they land on the card
  // they paid for instead of a page that says nothing about it.
  const cardId = sanitizeLine(parsed.data.cardId, 80)
  if (!requestedRegion && !jobId) return fail(400, 'Say which region’s job prices you want to unlock.', { code: 'missing_price_region' })

  try {
    const KNOWN: PayRegion[] = ['Africa', 'Americas', 'Europe', 'Asia']
    const job = jobId ? await loadJobCard(jobId) : null
    if (jobId) {
      if (!/^[A-Za-z0-9_-]{3,80}$/.test(jobId)) return fail(400, 'Unknown job reference.', { code: 'bad_job_id' })
      if (!job) return fail(404, 'That job card is not on the board any more.', { code: 'job_not_found' })
    }

    // The region being *bought* is not a locked board — it is the thing on sale. So this route does
    // not gate on it. What it does refuse is selling a tier the member is already standing in: their
    // own board is included, free, and charging for it would take money for nothing.
    const target = (requestedRegion || String(job?.region ?? '')) as PayRegion
    if (!KNOWN.includes(target)) return fail(400, 'That is not a price region.', { code: 'bad_price_region' })
    const ownRegion = await requestRegion(req)
    if (ownRegion === target) {
      return fail(409, 'That region’s board is already open to you — there is nothing to pay for.', { code: 'price_already_open' })
    }
    const unlocked = await requestUnlockedRegions(req, uid)
    if (unlocked.includes(target)) {
      return fail(409, 'You have already unlocked those prices.', { code: 'price_already_unlocked' })
    }

    // Priced from the tier, never from the request: a stated per-card fee if one exists for that
    // region, otherwise the tier's ceiling. Capped by the same rule as the pay it unlocks.
    const statedFee = job ? Number(job.trainingFeeUsd ?? 0) || 0 : 0
    const feeUsd = priceAccessFeeUsd({ trainingFeeUsd: statedFee }, target)
    const amountKes = trainingFeeKesFor(feeUsd)
    const subunits = paystackSubunitsFor(feeUsd)

    const reference = `aw_px_${randomId(10)}`
    const { origin: callbackOrigin, popupMode } = browserReachableOrigin(req)
    const returnPath = /^[A-Za-z0-9_-]{3,80}$/.test(cardId)
      ? `/training/${encodeURIComponent(cardId)}?region=${encodeURIComponent(target)}`
      : `/prices?region=${encodeURIComponent(target)}`
    const callbackUrl = popupMode ? '' : `${callbackOrigin}${returnPath}`

    const upstream = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: subunits,
        currency: 'KES',
        reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        metadata: {
          uid,
          jobId: jobId || cardId,
          priceRegion: target,
          purpose: PRICE_ACCESS_PURPOSE,
          expectedAmountKes: amountKes,
          returnPath,
        },
      }),
      cache: 'no-store',
    })

    const data = (await upstream.json().catch(() => null)) as
      | { status?: boolean; message?: string; data?: { authorization_url?: string; access_code?: string; reference?: string } }
      | null

    if (!upstream.ok || !data?.status || !data.data?.authorization_url) {
      await audit({ action: 'PAYMENT_INIT_FAILED', actorEmail: email, details: { jobId, status: upstream.status, message: data?.message?.slice(0, 160) }, req })
      return fail(502, 'The payment provider refused to open a checkout session. Please try again.', { code: 'paystack_init_failed' })
    }

    const { recordPaymentTransactionAdmin } = await import('@/lib/firestore-admin')
    await recordPaymentTransactionAdmin({
      reference: data.data.reference || reference,
      email,
      userId: uid,
      amountKes,
      amountUsd: trainingFeeUsdFor(feeUsd),
      currency: 'KES',
      status: 'pending',
      jobId,
      metadata: {
        accessCode: data.data.access_code ?? '',
        expectedSubunits: subunits,
        purpose: PRICE_ACCESS_PURPOSE,
        // The region is written on the server's row, so verification never has to trust a later
        // request to say which tier was paid for.
        priceRegion: target,
        returnPath,
      },
    }).catch((err) => console.warn('[paystack/initialize] pending row not written:', err))

    await audit({ action: 'PAYMENT_INIT', actorEmail: email, details: { jobId, reference: data.data.reference || reference, amountKes }, req })

    return json({
      ok: true,
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code ?? '',
      reference: data.data.reference || reference,
      amountKes,
      currency: 'KES',
      expiresInSec: 600,
      // true = no browser-reachable callback origin exists, so the checkout must NOT navigate the
      // tab away; the client opens Paystack in a new window and confirms the charge itself.
      popupMode,
    })
  } catch (err) {
    return routeError('paystack/initialize', err)
  }
}
