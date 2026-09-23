import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { Spinner } from '@qualy/ui/spinner'
import { RotateCwIcon } from 'lucide-react'

const nudge = stylex.keyframes({
  '0%, 100%': { transform: 'translateX(0)' },
  '25%': { transform: 'translateX(-6px)' },
  '50%': { transform: 'translateX(5px)' },
  '75%': { transform: 'translateX(-3px)' },
})

const styles = stylex.create({
  failureFull: {
    display: 'flex',
    minHeight: '100dvh',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  // the page's own failure sits where the page would have been - centred in
  // the shell's content, not stacked in its corner like a caption of nothing
  failureInline: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingInline: 24,
    textAlign: 'center',
  },
  // a small shake sideways of the button pressed: the same answer, again
  failedAgain: {
    animationName: { default: nudge, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '360ms',
    animationTimingFunction: 'ease-in-out',
  },
  quiet: {
    fontSize: 14,
    lineHeight: '1.25rem',
    color: 'var(--q-muted-foreground)',
  },
})

// a plugin component failed: the user gets a localized message and a retry,
// never a stack trace
export function Failure({
  message,
  onRetry,
  fullscreen,
}: {
  message: string
  onRetry?: () => void
  fullscreen?: boolean
}) {
  const { format } = useI18n()
  // A retry either leaves - the page arrives - or comes back as this same
  // notice, freshly mounted in the same place, which looked like a press
  // that did nothing. So the press is shown before it is acted on, and a
  // notice that comes back right after one says it is a new answer.
  const [trying, setTrying] = useState(false)
  const [again] = useState(() => performance.now() - retriedAt < RETRY_ECHO_MS)
  return (
    <div
      {...stylex.props(fullscreen ? styles.failureFull : styles.failureInline)}
      role="alert"
      data-again={again || undefined}
    >
      <p {...stylex.props(styles.quiet)}>{message}</p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className={stylex.props(again && styles.failedAgain).className}
          disabled={trying}
          aria-busy={trying || undefined}
          onClick={() => {
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
          {format(commonMessages.retry)}
        </Button>
      )}
    </div>
  )
}

/** how long a press on retry is seen before it is acted on */
const RETRY_SHOWN_MS = 350
/** how soon after a retry a notice coming back counts as its answer */
const RETRY_ECHO_MS = 3000
/** when retry was last pressed, on this page */
let retriedAt = Number.NEGATIVE_INFINITY
