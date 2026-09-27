import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCwIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { Alert, AlertDescription } from '../alert.tsx'
import { Button } from '../button.tsx'
import { ResourceState, type ResourceFailure } from '../resource-state.tsx'
import { Spinner } from '../spinner.tsx'

const styles = stylex.create({
  waiting: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: 32,
  },
})

// loading, failed, or the content: the three states every remote section
// has, so no screen invents its own combination of them
export function AsyncSection({
  pending,
  error,
  errorAction,
  retrying = false,
  framed = false,
  headingLevel = framed ? 2 : 3,
  loadingLabel,
  retryLabel,
  onRetry,
  skeleton,
  xstyle,
  className,
  children,
}: {
  pending: boolean
  /**
   * Why the section could not load: a reading failure already worded and
   * classified (web-runtime's `useLoadFailure`), which carries a heading and
   * says whether a retry can help; or, from callers not yet speaking that,
   * one sentence, which is shown as it was before - a line with a retry,
   * never raised to a heading it was not written to be.
   */
  error?: ResourceFailure | string | null
  /** another way out beside the retry, such as back to the list */
  errorAction?: ReactNode
  /** a retry is on its way: the button says so rather than taking a second press */
  retrying?: boolean
  /**
   * The section stands on the page's bare ground rather than inside a card
   * or a dialog, so a failure draws a card of its own to stand on.
   */
  framed?: boolean
  /**
   * The failure heading's rank: under the page's own title (2) on bare
   * ground, under a card's or a dialog's title (3) inside one - which is
   * what `framed` already says, so it is only given to say otherwise.
   */
  headingLevel?: 2 | 3 | 4
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
  // Whether a retry pressed here has been answered, and answered with the
  // same failure: the one moment worth interrupting a reader for, and each
  // time it happens is news again. Until then the failure is said politely.
  // Told by the section going busy - `retrying`, or back to loading - and
  // coming back down, so a caller that does not say when it is retrying
  // never has an interruption raised at the press itself, before any answer.
  const [asked, setAsked] = useState<'no' | 'pressed' | 'retrying'>('no')
  const [failedAgain, setFailedAgain] = useState(0)
  const failing = !pending && Boolean(error)
  const busy = retrying || pending
  if (!failing && !pending && (asked !== 'no' || failedAgain !== 0)) {
    setAsked('no')
    setFailedAgain(0)
  }
  if (asked === 'pressed' && busy) setAsked('retrying')
  if (asked === 'retrying' && failing && !busy) {
    setAsked('no')
    setFailedAgain(failedAgain + 1)
  }
  // The retry keeps the focus it was pressed with while it works, so a
  // keyboard is not dropped to the top of the page; if the section went
  // back to loading meanwhile and the button was drawn anew, the answer
  // hands focus back to it - never away from anything else.
  const retryButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (failedAgain === 0) return
    const active = document.activeElement
    if (active === null || active === document.body) retryButton.current?.focus()
  }, [failedAgain])
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
    // Centred in the room the section would have had, and no dashed
    // outline: a dashed box reads as a place something will be dropped, not
    // as an answer. A failure that another try cannot change - not there,
    // not the reader's - offers no retry to press.
    // A bare sentence is all a caller not yet speaking the classified form
    // gives: it stays one line under the mark, at the size it was written
    // for, and ends without the full stop a hint does not take.
    const failure: Omit<ResourceFailure, 'title'> & { readonly title?: string } =
      typeof error === 'string'
        ? { kind: 'failed', description: error.replace(/[。.]$/u, ''), retryable: true }
        : error
    return (
      <ResourceState
        size="section"
        framed={framed}
        kind={failure.kind}
        {...(failure.title === undefined ? {} : { title: failure.title })}
        description={failure.description}
        headingLevel={headingLevel}
        live={failedAgain > 0 ? 'assertive' : 'polite'}
        announcement={failedAgain}
        actions={[
          ...(failure.retryable
            ? [
                <Button
                  key="retry"
                  ref={retryButton}
                  variant="outline"
                  size="sm"
                  // refused rather than disabled: a disabled button lets go
                  // of the focus it holds
                  aria-disabled={retrying || undefined}
                  aria-busy={retrying || undefined}
                  onClick={() => {
                    if (retrying) return
                    setAsked('pressed')
                    onRetry()
                  }}
                >
                  {/* the same seat before and during: the button does not grow */}
                  {retrying ? <Spinner aria-hidden /> : <RotateCwIcon aria-hidden />}
                  {retryLabel}
                </Button>,
              ]
            : []),
          ...(errorAction === undefined ? [] : [errorAction]),
        ]}
        {...(xstyle === undefined ? {} : { xstyle })}
        {...(className === undefined ? {} : { className })}
      />
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
