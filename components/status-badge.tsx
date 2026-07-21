import { cn } from '@/lib/utils'
import type { StatusTone } from '@/lib/afterworks-data'

const toneStyles: Record<StatusTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-accent text-accent-foreground',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/20 text-warning-foreground',
  danger: 'bg-destructive/10 text-destructive',
}

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        toneStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
