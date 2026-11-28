'use client'

/**
 * The price tiers, and what it costs to work them.
 *
 * This panel is where the platform's new rule becomes something a member can do: their own board is
 * included, and each other region's prices can be bought once. It is deliberately *not* a replacement
 * for the training pages — those keep their modules and their tasks — it only sells the right to earn
 * another region's rates.
 *
 * The amounts shown are computed from the same table the checkout charges (`priceAccessFeeUsd`), so a
 * member never sees one number here and a different one on Paystack. Nothing here is authoritative:
 * `/api/paystack/initialize` re-prices the tier and refuses a tier that is already open or already
 * bought, and the entitlement is written by `/api/paystack/verify` or the webhook, never by this
 * component.
 */

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, Globe2, Lock, Loader2, Wallet } from 'lucide-react'
import { useAfterWorks } from '@/components/afterworks-provider'
import { Button } from '@/components/ui/button'
import { formatUsd } from '@/lib/afterworks-data'
import { authedFetch, describeError } from '@/lib/client-api'
import { PAY_REGIONS, REGION_PAY_CEILING, type PayRegion } from '@/lib/pay-regions'
import { priceAccessFeeUsd, priceTierOrder } from '@/lib/price-access'
import { cn } from '@/lib/utils'

/** Why a tier is locked, in the member's own terms rather than a status code. */
function lockReason(region: PayRegion, ownRegion: PayRegion, unlocked: string[]): string | null {
  if (region === ownRegion) return null
  if (unlocked.includes(region)) return null
  return `locked`
}

export function PriceAccessPanel() {
  const { jobRegion, payouts, unlockedPriceRegions, mode, refreshWallet } = useAfterWorks()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ownRegion: PayRegion = (jobRegion?.region as PayRegion) ?? 'Africa'
  const tiers = priceTierOrder(ownRegion)
  const demo = mode === 'demo'

  async function buy(region: PayRegion) {
    if (pending) return
    setError(null)
    setPending(region)
    try {
      const data = await authedFetch<{ authorizationUrl: string; reference: string; popupMode?: boolean }>(
        '/api/paystack/initialize',
        { method: 'POST', body: { priceRegion: region }, timeoutMs: 20_000 },
      )
      if (data.popupMode === true) {
        const popup = window.open(data.authorizationUrl, '_blank', 'width=480,height=720')
        if (!popup) {
          setError('The secure payment window could not open. Please allow pop-ups for this site, then try again.')
          setPending(null)
          return
        }
        // The charge settles in the popup; the wallet refresh below is what reflects the unlock once
        // Paystack's webhook or the verify route has written it. Nothing here grants the entitlement.
        const timer = window.setInterval(() => {
          if (popup.closed) {
            window.clearInterval(timer)
            void refreshWallet()
            setPending(null)
          }
        }, 1000)
        return
      }
      window.location.assign(data.authorizationUrl)
    } catch (err) {
      setError(describeError(err))
      setPending(null)
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Globe2 className="size-4 text-primary" />
          Job prices by region
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every task pays its board&apos;s hourly rate. Your own board — {ownRegion} — is included. Unlock
          another region once and its cards pay that region&apos;s prices, for good.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        <li className="flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{ownRegion}</p>
              <p className="text-xs text-muted-foreground">Your board — up to {formatUsd(REGION_PAY_CEILING[ownRegion])} an hour</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">
            Included
          </span>
        </li>

        {tiers.map((region) => {
          const reason = lockReason(region, ownRegion, unlockedPriceRegions)
          const open = reason === null
          const fee = priceAccessFeeUsd({ trainingFeeUsd: 0 }, region)
          const busy = pending === region
          return (
            <li
              key={region}
              className={cn(
                'flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
                open ? 'border-success/30 bg-success/5' : 'border-border bg-background',
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {open ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : (
                  <Lock className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{region}</p>
                  <p className="text-xs text-muted-foreground">
                    {open
                      ? 'Unlocked — its cards pay this region’s rates'
                      : `Cards pay up to ${formatUsd(REGION_PAY_CEILING[region])} an hour`}
                  </p>
                </div>
              </div>
              {open ? (
                <span className="shrink-0 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">
                  Unlocked
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || demo}
                  onClick={() => void buy(region)}
                  className="shrink-0 gap-1.5"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
                  Unlock {formatUsd(fee)}
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <Wallet className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Earnings stay in your balance until they reach{' '}
          <strong className="text-foreground">
            {payouts.withdrawalThresholdUsd > 0 ? formatUsd(payouts.withdrawalThresholdUsd) : 'your board total + $1'}
          </strong>{' '}
          — the total of every task price on your board, plus $1. You have {formatUsd(payouts.clearedUsd)} saved
          {payouts.thresholdShortfallUsd > 0 ? `, so ${formatUsd(payouts.thresholdShortfallUsd)} to go.` : '.'}
        </span>
      </p>

      {error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href="/jobs" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          Back to the board <ArrowRight className="size-3.5" />
        </Link>
        <span className="text-xs text-muted-foreground">
          {payouts.kycVerified ? 'Identity verified.' : 'Identity verification is needed before a task unlocks.'}
        </span>
      </div>
    </section>
  )
}

/** The regions this panel can ever offer, exported for the page that frames it. */
export const PRICE_ACCESS_REGIONS = PAY_REGIONS
