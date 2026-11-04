'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Ban } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Anti copy/paste wrapper for assessment questions (job-card assessments and the training quick
 * checks).
 *
 * Client-side only, so this is deterrence, not a hard guarantee — a worker who disables JavaScript
 * can still select text. What it does do, everywhere a question is shown:
 *  • blocks the clipboard events (copy / cut / paste) inside the wrapped area, so question and
 *    option text cannot be copied out and answers cannot be pasted in;
 *  • blocks the right-click context menu (the usual copy path);
 *  • disables text selection via CSS (`user-select: none`);
 *  • flashes a visible warning the moment a worker tries any of the above, so the attempt is
 *    obvious rather than silently swallowed.
 */
export function NoCopyPaste({
  children,
  className,
  note = 'Copy and paste are disabled during this assessment.',
}: {
  children: ReactNode
  className?: string
  /** Static hint shown under the warning area; set to '' to hide. */
  note?: string
}) {
  const [warning, setWarning] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const block = useCallback((event: ClipboardEvent | MouseEvent) => {
    event.preventDefault()
    setWarning(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setWarning(false), 2600)
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return (
    <div
      className={cn('select-none', className)}
      style={{ WebkitUserSelect: 'none', MozUserSelect: 'none', msUserSelect: 'none' }}
      onCopy={block}
      onCut={block}
      onPaste={block}
      onContextMenu={block}
      data-no-copy-paste
    >
      <div className="flex flex-col gap-1.5">
        {warning && (
          <p
            role="alert"
            className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
          >
            <Ban className="size-3.5 shrink-0" />
            Copy, cut and paste are blocked here — answer from what you learned in the training.
          </p>
        )}
        {note && !warning && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Ban className="size-3.5 shrink-0" />
            {note}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}
