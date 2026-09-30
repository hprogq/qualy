import { useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'

import { Button } from '@qualy/ui/button'
import { Spinner } from '@qualy/ui/spinner'
import { ResourceState, type ResourceStateKind } from '@qualy/ui/resource-state'
import { RotateCwIcon } from 'lucide-react'
import * as commonMessages from '@qualy/web-i18n/messages'

const nudge = stylex.keyframes({
  '0%, 100%': { transform: 'translateX(0)' },
  '25%': { transform: 'translateX(-6px)' },
  '50%': { transform: 'translateX(5px)' },
  '75%': { transform: 'translateX(-3px)' },
})

const styles = stylex.create({
  // standing alone, with no shell around it: the state is the viewport
  fullscreen: {
    minHeight: '100dvh',
  },
  // a small shake sideways of the button pressed: the same answer, again
  failedAgain: {
    animationName: { default: nudge, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '360ms',
    animationTimingFunction: 'ease-in-out',
  },
})

// Something the product itself could not draw - a page's code that failed,
// the shell, the manifest everything stands under. The reader gets a heading
// in their language, what to do about it, and a retry; never a stack trace.
// It stands where the page would have been, the same state a page draws for
// a record that is not there, so every "this cannot be shown" in the product
// looks like one thing - and is heard as one: focus goes to its heading,
// which a screen reader reads out, rather than an alert said on top of it.
export function Failure({
  title,
  description,
  kind = 'failed',
  onRetry,
  fullscreen,
  actions = [],
}: {
  title: string
  description?: string
  /** why, when it is known; a failure of the product's own code otherwise */
  kind?: ResourceStateKind
  onRetry?: () => void
  fullscreen?: boolean
  /** further ways out, after the retry */
  actions?: readonly ReactNode[]
}) {
  // A retry either leaves - the page arrives - or comes back as this same
  // notice, freshly mounted in the same place, which looked like a press
  // that did nothing. So the press is shown before it is acted on, and a
  // notice that comes back right after one says it is a new answer.
  const [trying, setTrying] = useState(false)
  const [again] = useState(() => performance.now() - retriedAt < RETRY_ECHO_MS)
  const retry =
    onRetry === undefined ? null : (
      <Button
        key="retry"
        className={stylex.props(again && styles.failedAgain).className}
        // refused rather than disabled, so the focus stays on it
        aria-disabled={trying || undefined}
        aria-busy={trying || undefined}
        onClick={() => {
          if (trying) return
          setTrying(true)
          setTimeout(() => {
            retriedAt = performance.now()
            onRetry()
            setTrying(false)
          }, RETRY_SHOWN_MS)
        }}
      >
        {/* the same seat before and during: the button does not grow */}
        {trying ? <Spinner aria-hidden /> : <RotateCwIcon aria-hidden />}
        {commonMessages.action_retry()}
      </Button>
    )
  return (
    <ResourceState
      data-again={again ? 'true' : undefined}
      kind={kind}
      title={title}
      {...(description === undefined ? {} : { description })}
      actions={retry === null ? actions : [retry, ...actions]}
      {...(fullscreen === true ? { xstyle: styles.fullscreen } : {})}
    />
  )
}

/** how long a press on retry is seen before it is acted on */
const RETRY_SHOWN_MS = 350
/** how soon after a retry a notice coming back counts as its answer */
const RETRY_ECHO_MS = 3000
/** when retry was last pressed, on this page */
let retriedAt = Number.NEGATIVE_INFINITY
