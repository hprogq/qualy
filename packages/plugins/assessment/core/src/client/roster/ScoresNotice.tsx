import { TriangleAlertIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

export function ScoresNotice({
  cause,
  reason,
  busy,
  onRetry,
}: {
  busy: boolean
  onRetry: () => void
} & ({ cause: 'request'; reason: string } | { cause: 'scoring-unavailable'; reason?: never })) {
  return (
    <Alert layout="line" data-testid="roster-scores-failed" data-cause={cause}>
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>
        {cause === 'request' ? m.roster_scoresFailed() : m.roster_scoreUnavailable()}
      </AlertTitle>
      {reason && <AlertDescription>{reason}</AlertDescription>}
      <AlertAction>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
          {commonMessages.action_retry()}
        </Button>
      </AlertAction>
    </Alert>
  )
}
