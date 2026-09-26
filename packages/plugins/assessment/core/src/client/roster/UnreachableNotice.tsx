import { TriangleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Alert, AlertAction, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { assessmentMessages as m } from '../i18n.ts'

// One line saying how many on the roster some question's review steps find
// nowhere - they sit under no unit a step asks for - so they cannot file it,
// and the button that shows which questions and whom. It stays up for as
// long as it is true: nothing about the roster or the questions refuses a
// change over it (§32.93), so this is where somebody running the round
// finds out, rather than the person who tries to file.

const styles = stylex.create({
  // room at the end for the button that sits over it
  notice: { paddingRight: 112 },
  // amber, as everything waiting on somebody's decision is said
  icon: { color: tokens.warning },
  prompt: { fontWeight: 400, WebkitLineClamp: 'none' },
  // centred against the one line this notice is
  action: { insetBlockStart: '50%', transform: 'translateY(-50%)' },
})

export function UnreachableNotice({
  cannotSubmit,
  onOpen,
}: {
  /** people some question's ordinary route finds nowhere, each counted once */
  cannotSubmit: number
  onOpen: () => void
}) {
  const { format } = useI18n()
  if (cannotSubmit === 0) return null
  return (
    <Alert
      data-testid="unreachable-notice"
      data-count={String(cannotSubmit)}
      className={stylex.props(styles.notice).className}
    >
      <TriangleAlertIcon aria-hidden {...stylex.props(styles.icon)} />
      <AlertTitle className={stylex.props(styles.prompt).className}>
        {format(m.rosterUnreachablePrompt, { count: cannotSubmit })}
      </AlertTitle>
      <AlertAction className={stylex.props(styles.action).className}>
        <Button size="sm" variant="outline" onClick={onOpen}>
          {format(m.rosterUnreachableOpen)}
        </Button>
      </AlertAction>
    </Alert>
  )
}
