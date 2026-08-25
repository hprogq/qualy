import type { ReactNode } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { Alert, AlertDescription } from '../alert.tsx'
import { Button } from '../button.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '../empty.tsx'
import { Spinner } from '../spinner.tsx'

// loading, failed-with-retry, or the content — the three states every remote
// section has, so no screen invents its own combination of them
export function AsyncSection({
  pending,
  error,
  loadingLabel,
  retryLabel,
  onRetry,
  skeleton,
  className,
  children,
}: {
  pending: boolean
  error?: string | null
  loadingLabel: string
  retryLabel: string
  onRetry: () => void
  /** what the section looks like while it loads; a spinner when absent */
  skeleton?: ReactNode
  /** carried by every branch, for a section that has to fill its parent */
  className?: string
  children: ReactNode
}) {
  if (pending) {
    if (skeleton) {
      return (
        <div role="status" aria-label={loadingLabel} className={className}>
          {skeleton}
        </div>
      )
    }
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Spinner aria-label={loadingLabel} />
      </div>
    )
  }
  if (error) {
    // Centred and given room, rather than a red bar hugging the left edge.
    // A section that could not load is the whole of what the reader is
    // looking at, and the sentence and its one action should be where their
    // eye already is.
    return (
      <Empty className={cn('rounded-lg border border-dashed', className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return className === undefined ? <>{children}</> : <div className={className}>{children}</div>
}

export function Feedback({
  message,
  tone = 'error',
}: {
  message?: string | null
  tone?: 'error' | 'success'
}) {
  if (!message) return null
  return (
    // what kind of answer this is, beside the sentence carrying it: a test
    // about "it saved" asks for the tone, not for the wording of the note
    <Alert
      data-testid="feedback"
      data-tone={tone}
      variant={tone === 'error' ? 'destructive' : 'default'}
      role="alert"
    >
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
