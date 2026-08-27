import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useI18n } from '@qualy/web-i18n'
import { Alert, AlertAction, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { assessmentMessages as m } from '../i18n.ts'

// One line saying something changed, and the button that opens it.
//
// The changes themselves can run to thousands of rows, so they are not what a
// reader meets on arrival: the subject of this page is the people working on
// the batch, and it has to start at the top of the screen.
//
// The icon carries the difference between the two states, not a colour: a
// standing fact and a decision somebody owes are both worth a line, but only
// one of them is worth an alarm.

const styles = stylex.create({
  // room at the end for the button that sits over it
  notice: { paddingRight: 112 },
  prompt: { fontWeight: 400, WebkitLineClamp: 'none' },
  // centred against the one line this notice is, not hung from the top
  // corner: the primitive's anchor suits alerts with a body, and against a
  // single line it reads as a button that slipped
  action: { insetBlockStart: '50%', transform: 'translateY(-50%)' },
})

export function AccessSyncNotice({
  pendingTotal,
  lapsedTotal,
  onOpen,
}: {
  pendingTotal: number
  lapsedTotal: number
  onOpen: () => void
}) {
  const { format } = useI18n()
  if (pendingTotal === 0 && lapsedTotal === 0) return null
  const decide = pendingTotal > 0

  return (
    // what the round is being told about its own staffing, as counts: a
    // decision owed, or a lapse to be aware of
    <Alert
      data-testid="access-sync-notice"
      data-kind={decide ? 'decide' : 'lapsed'}
      data-pending={String(pendingTotal)}
      data-lapsed={String(lapsedTotal)}
      className={stylex.props(styles.notice).className}
    >
      {decide ? <TriangleAlertIcon /> : <InfoIcon />}
      <AlertTitle className={stylex.props(styles.prompt).className}>
        {format(decide ? m.accessSyncPrompt : m.accessSyncLapsedPrompt)}
      </AlertTitle>
      <AlertAction className={stylex.props(styles.action).className}>
        <Button size="sm" variant="outline" onClick={onOpen}>
          {format(m.accessSyncOpen)}
        </Button>
      </AlertAction>
    </Alert>
  )
}
