import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { Alert, AlertAction, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { assessmentMessages as m } from '../i18n.ts'

// One line saying the organization has people somewhere other than this
// round does, and the button that opens the differences. The rows themselves
// are not what a reader meets on arrival: the subject of the page is the
// roster, and it has to start at the top of the screen.

const styles = stylex.create({
  // room at the end for the button that sits over it
  notice: { paddingRight: 112 },
  prompt: { fontWeight: 400, WebkitLineClamp: 'none' },
  // centred against the one line this notice is
  action: { insetBlockStart: '50%', transform: 'translateY(-50%)' },
})

export function PlacementNotice({
  changedTotal,
  unavailableTotal,
  onOpen,
}: {
  changedTotal: number
  unavailableTotal: number
  onOpen: () => void
}) {
  const { format } = useI18n()
  if (changedTotal === 0 && unavailableTotal === 0) return null
  const decide = changedTotal > 0

  return (
    <Alert
      data-testid="placement-notice"
      data-changed={String(changedTotal)}
      data-unavailable={String(unavailableTotal)}
      className={stylex.props(styles.notice).className}
    >
      {decide ? <TriangleAlertIcon /> : <InfoIcon />}
      <AlertTitle className={stylex.props(styles.prompt).className}>
        {decide
          ? format(m.placementPrompt, { count: changedTotal })
          : format(m.placementUnavailablePrompt, { count: unavailableTotal })}
      </AlertTitle>
      <AlertAction className={stylex.props(styles.action).className}>
        <Button size="sm" variant="outline" onClick={onOpen}>
          {format(m.placementOpen)}
        </Button>
      </AlertAction>
    </Alert>
  )
}
