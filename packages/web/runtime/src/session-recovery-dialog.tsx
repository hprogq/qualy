import { useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ArrowRightLeftIcon, ExternalLinkIcon, LockKeyholeIcon } from 'lucide-react'
import { Wordmark } from '@qualy/brand/wordmark'
import { Button } from '@qualy/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@qualy/ui/dialog'
import { Spinner } from '@qualy/ui/spinner'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'

// What a page shows while its session is being recovered
// (session-recovery-gate.tsx holds the states; this only draws them).
//
// A lock over the page rather than a warning: a plain dialog, not an alert
// dialog, since it stays up for as long as signing in takes, and one that
// only its own buttons end - no corner button, and neither Escape nor a
// click outside does anything, the open state being the gate's alone. The
// page behind stays mounted under the family's veil, whose blur leaves its
// shape to be made out but not its words, and the wordmark at the top says
// the lock is the product's own: on a phone the panel is nearly all there
// is to see.

/**
 * expired: the session went; waiting: the sign-in page is open in a tab of
 * its own; blocked: the browser would not open that tab; switched: somebody
 * else signed in there, and the page cannot carry on as them.
 */
export type SessionRecoveryState = 'expired' | 'waiting' | 'blocked' | 'switched'

const styles = stylex.create({
  panel: {
    alignItems: 'center',
    textAlign: 'center',
    gap: 20,
    paddingTop: 20,
  },
  brand: {
    color: tokens.mutedForeground,
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    display: 'inline-flex',
    width: 44,
    height: 44,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.foreground,
  },
  title: {
    display: 'block',
    fontSize: 17,
    lineHeight: 1.3,
    fontWeight: 600,
  },
  hint: {
    display: 'block',
    maxWidth: '22rem',
    lineHeight: 1.6,
    textWrap: 'pretty',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    alignSelf: 'stretch',
    gap: 8,
  },
})

export function SessionRecoveryDialog({
  state,
  signInHref,
  onSignIn,
  onOpenedYourself,
  onSignOut,
  onReload,
}: {
  /** nothing to recover: the dialog is closed */
  state: SessionRecoveryState | undefined
  /** the sign-in page, for a link the reader follows themselves */
  signInHref: string
  onSignIn: () => void
  /** the reader followed that link */
  onOpenedYourself: () => void
  onSignOut: () => void
  onReload: () => void
}) {
  const { format } = useI18n()
  // what it said last, kept through the close so the panel does not change
  // its words while it fades
  const [shown, setShown] = useState<SessionRecoveryState>(state ?? 'expired')
  if (state !== undefined && state !== shown) setShown(state)

  const face: Record<SessionRecoveryState, { icon: ReactNode; title: string; hint: string }> = {
    expired: {
      icon: <LockKeyholeIcon aria-hidden size={20} />,
      title: format(commonMessages.sessionLostTitle),
      hint: format(commonMessages.sessionLostHint),
    },
    waiting: {
      icon: <Spinner aria-hidden />,
      title: format(commonMessages.sessionWaitingTitle),
      hint: format(commonMessages.sessionWaitingHint),
    },
    blocked: {
      icon: <ExternalLinkIcon aria-hidden size={20} />,
      title: format(commonMessages.sessionBlockedTitle),
      hint: format(commonMessages.sessionBlockedHint),
    },
    switched: {
      icon: <ArrowRightLeftIcon aria-hidden size={20} />,
      title: format(commonMessages.sessionSwitchedTitle),
      hint: format(commonMessages.sessionSwitchedHint),
    },
  }
  const { icon, title, hint } = face[shown]

  const primary =
    shown === 'switched' ? (
      <Button data-testid="session-reload" onClick={onReload}>
        {format(commonMessages.sessionReload)}
      </Button>
    ) : shown === 'blocked' ? (
      // a link the reader follows: what a browser blocks is a tab a page
      // opens, not one a person does
      <Button asChild>
        <a
          data-testid="session-sign-in"
          href={signInHref}
          target="_blank"
          rel="noopener"
          onClick={onOpenedYourself}
        >
          {format(commonMessages.sessionOpenSignIn)}
        </a>
      </Button>
    ) : (
      <Button data-testid="session-sign-in" onClick={onSignIn}>
        {format(shown === 'waiting' ? commonMessages.sessionReopen : commonMessages.sessionSignIn)}
      </Button>
    )

  return (
    // open is the gate's alone: with no way to change it here, the dialog's
    // own ways of closing do nothing
    <Dialog open={state !== undefined}>
      <DialogContent
        showCloseButton={false}
        // it opens on its own, not on a press: focus rests on the panel, and
        // the first Tab reaches the way on
        restfulFocus
        size="24rem"
        xstyle={styles.panel}
        data-testid="session-recovery"
        data-state={shown}
      >
        <Wordmark height={13} xstyle={styles.brand} />
        <div {...stylex.props(styles.head)}>
          <span {...stylex.props(styles.badge)}>{icon}</span>
          {/* inner spans: the title and description take no style seat, and a
              class beside the family's own would be decided by sheet order */}
          <DialogTitle>
            <span {...stylex.props(styles.title)}>{title}</span>
          </DialogTitle>
          <DialogDescription>
            <span {...stylex.props(styles.hint)}>{hint}</span>
          </DialogDescription>
        </div>
        <div {...stylex.props(styles.actions)}>
          {primary}
          {shown !== 'switched' && (
            <Button variant="ghost" data-testid="session-sign-out" onClick={onSignOut}>
              {format(commonMessages.sessionSignOut)}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
