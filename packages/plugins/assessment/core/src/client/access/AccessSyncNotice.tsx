import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
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
      className="pr-28"
    >
      {decide ? <TriangleAlertIcon /> : <InfoIcon />}
      <AlertTitle className="line-clamp-none font-normal">
        {format(decide ? m.accessSyncPrompt : m.accessSyncLapsedPrompt)}
      </AlertTitle>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={onOpen}>
          {format(m.accessSyncOpen)}
        </Button>
      </AlertAction>
    </Alert>
  )
}
