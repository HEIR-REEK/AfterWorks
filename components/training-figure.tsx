import { safeImageSrc } from '@/lib/afterworks-data'
import { cn } from '@/lib/utils'

/**
 * A training figure that can come from the built-in course or an authored note.
 *
 * Only same-origin paths and plain https URLs survive `safeImageSrc`, so a pasted `javascript:`
 * or `data:` value is omitted rather than rendered. The built-in course ships its figures as
 * inline SVG files in `public/training`, which do not depend on a third-party CDN.
 */
export function TrainingFigure({
  src,
  alt,
  caption,
  className,
}: {
  src?: string
  alt?: string
  caption?: string
  className?: string
}) {
  const safeSrc = safeImageSrc(src)
  if (!safeSrc) return null
  return (
    <figure className={cn('overflow-hidden rounded-xl border border-border bg-muted/20', className)}>
      {/* Authored content: a plain img keeps SVG and remote https figures interchangeable. */}
      <div className="overflow-x-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={safeSrc}
          alt={alt ?? ''}
          loading="lazy"
          className="block h-auto w-full min-w-[560px] sm:min-w-0"
        />
      </div>
      {caption && (
        <figcaption className="border-t border-border/60 bg-card/80 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
