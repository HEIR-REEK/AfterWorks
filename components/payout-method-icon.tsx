import { Landmark, Smartphone, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The icon for a payout method, in one place.
 *
 * This existed as an inline `method === 'Bank Transfer' ? <Landmark/> : <Smartphone/>` ternary in the
 * wallet and again in the console, which is how a third method ends up wearing the M-Pesa icon. One
 * component means adding a fourth method changes one file.
 *
 * Deliberately not a client component: it renders the same on the server and needs no state, so the
 * wallet page and the console drawer can both use it without pulling anything into the browser bundle.
 */
export function PayoutMethodIcon({
  method,
  className,
}: {
  method: unknown
  className?: string
}) {
  const value = String(method ?? '')
  if (value === 'Bank Transfer') return <Landmark className={cn('shrink-0', className)} aria-hidden />
  if (value === 'PayPal') return <Wallet className={cn('shrink-0', className)} aria-hidden />
  return <Smartphone className={cn('shrink-0 text-success', className)} aria-hidden />
}

export default PayoutMethodIcon
