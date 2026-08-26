import type { ReactNode } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { Alert, AlertDescription } from '../alert.tsx'
import { Button } from '../button.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '../empty.tsx'
import { Spinner } from '../spinner.tsx'

const styles = stylex.create({
  waiting: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 32,
  },
  // the visible edge the bare empty state leaves to its callers
  bordered: {
    borderWidth: 1,
  },
})

// loading, failed-with-retry, or the content — the three states every remote
// section has, so no screen invents its own combination of them
export function AsyncSection({
  pending,
  error,
  loadingLabel,
  retryLabel,
  onRetry,
  skeleton,
  xstyle,
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
  xstyle?: StyleXStyles
  /** legacy escape hatch for callers still speaking utilities */
  className?: string
  children: ReactNode
}) {
  if (pending) {
    if (skeleton) {
      const sx = stylex.props(xstyle)
      return (
        <div
          role="status"
          aria-label={loadingLabel}
          {...sx}
          className={clsx(sx.className, className)}
        >
          {skeleton}
        </div>
      )
    }
    const sx = stylex.props(styles.waiting, xstyle)
    return (
      <div {...sx} className={clsx(sx.className, className)}>
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
      <Empty xstyle={[styles.bordered, xstyle]} className={className}>
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
  if (className === undefined && xstyle === undefined) return <>{children}</>
  const sx = stylex.props(xstyle)
  return (
    <div {...sx} className={clsx(sx.className, className)}>
      {children}
    </div>
  )
}

export function Feedback({
  message,
  tone = 'error',
  xstyle,
}: {
  message?: string | null
  tone?: 'error' | 'success'
  xstyle?: StyleXStyles
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
      {...(xstyle === undefined ? {} : { xstyle })}
    >
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
