import { TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { assessmentMessages as m } from '../i18n.ts'

// The page's totals did not come: the question failed as a whole, or the
// scoring service was down, which the server answers as one row saying so
// and the rest deferred. Either way each row only offers to ask about its
// own person; why none of them has a total, and the way to ask for the page
// again, is said once above them.

const styles = stylex.create({
  // room at the end for the button that sits over it
  notice: { paddingRight: 112 },
})

export function ScoresNotice({
  cause,
  reason,
  busy,
  onRetry,
}: {
  /** the question failed, or it was answered with the scoring service down */
  cause: 'request' | 'scoring-unavailable'
  reason: string
  /** the page's question is being asked again */
  busy: boolean
  onRetry: () => void
}) {
  const { format } = useI18n()
  return (
    <Alert
      data-testid="roster-scores-failed"
      data-cause={cause}
      className={stylex.props(styles.notice).className}
    >
      <TriangleAlertIcon />
      <AlertTitle>{format(m.rosterScoresFailed)}</AlertTitle>
      <AlertDescription>{reason}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
          {format(commonMessages.retry)}
        </Button>
      </AlertAction>
    </Alert>
  )
}
