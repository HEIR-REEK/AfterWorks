'use client'

/**
 * /prices — the region price tiers, where the unlock is bought.
 *
 * The checkout's callback URL points here (`/api/paystack/initialize` builds it), so a member who
 * returns from Paystack lands on the page that shows what they just bought rather than on a card that
 * has nothing to do with the charge. Confirmation itself is server-side: this page reads the
 * entitlement the verify route or the webhook wrote, and never grants anything of its own.
 */

import { PriceAccessPanel } from '@/components/price-access-panel'

export default function PricesPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Work another region’s prices</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A task pays its card’s hourly rate, and the rate depends on the region the card belongs to.
          Your own board is free. Unlock another region once to earn its rates on its cards.
        </p>
      </header>
      <PriceAccessPanel />
    </div>
  )
}
