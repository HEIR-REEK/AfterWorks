import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * The brand, drawn from the picture logo in `public/brand/`.
 *
 * Two marks exist because one asset never fits both jobs:
 *  • `mark.png`  — the square monogram, cropped and background-punched from the supplied logo. For
 *    32–48 px slots (navbars, status header, outage screen). Shown on a light tile because the artwork
 *    is dark teal/navy and would otherwise disappear in dark mode.
 *  • `lockup.png` — mark + AFTERWORKS wordmark. For centred, roomy places (sign-in, admin sign-in)
 *    where the wordmark is part of the message.
 *
 * Both files are pre-sized and quantised by `npm run brand:build`, and rendered with `unoptimized`,
 * because production has no image-optimiser dependency installed (`sharp`) — `/_next/image` returns 400
 * there, and a logo that depends on it is a logo that does not render.
 *
 * They live in `public/` rather than being imported from `components/` on purpose: the original
 * `logo.png` is a 1.14 MB 1408×768 PNG, and importing it made every page carry a megabyte-class
 * asset into the bundle graph. Next's image optimiser serves WebP/AVIF derivatives of the crops
 * instead, sized for the slot.
 */

export function BrandMark({ className, size = 36 }: { className?: string; size?: 28 | 32 | 36 | 40 | 44 }) {
  const box = { 28: 'h-7 w-7', 32: 'h-8 w-8', 36: 'h-9 w-9', 40: 'h-10 w-10', 44: 'h-11 w-11' }[size]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#F7F8F6] ring-1 ring-border',
        box,
        className,
      )}
    >
      {/* `unoptimized` is deliberate, not laziness: `sharp` is not a dependency of this project, so
          in production `next/image` cannot resize anything and `/_next/image` answers 400 — which is
          how the logo disappeared on `next start`. The file is pre-sized for this slot instead. If you
          ever add photographic content, install `sharp` before dropping this flag. */}
      <Image src="/brand/mark-96.png" alt="" width={96} height={96} unoptimized priority className="h-full w-full object-contain p-[2px]" />
    </span>
  )
}

export function BrandLockup({ className, width = 190 }: { className?: string; width?: number }) {
  return (
    <Image
      src="/brand/lockup.png"
      alt="AfterWorks"
      unoptimized
      width={620}
      height={361}
      priority
      className={cn('h-auto w-auto object-contain', className)}
      style={{ width, maxWidth: '100%' }}
    />
  )
}

/** Mark + wordmark text, the idiom used in the product chrome. */
export function BrandLink({
  href,
  label,
  className,
  size = 36,
  wordmarkClass,
}: {
  href: string
  label?: string
  className?: string
  size?: 28 | 32 | 36 | 40 | 44
  wordmarkClass?: string
}) {
  return (
    <Link href={href} className={cn('flex items-center gap-2.5', className)}>
      <BrandMark size={size} />
      {label ? <span className={cn('text-sm font-semibold tracking-tight sm:text-base', wordmarkClass)}>{label}</span> : null}
    </Link>
  )
}
