import * as stylex from '@stylexjs/stylex'
import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'

// What putting people on the roster left it with, where there is something
// to say: how many went on, and of them how many some question's review
// steps find nowhere, and how many are system accounts. The people are on
// the list either way (§32.93); this is the moment the reader who put them
// there is told, with the way to the questions concerned.

/**
 * What a roster write reports beside its count: null where the write went
 * through but what it left could not be read, which is left unsaid.
 */
export interface AdmissionOutcomeFacts {
  readonly added: number
  readonly cannotSubmit: number | null
  readonly systemAccounts: number | null
}

const styles = stylex.create({
  root: { display: 'flex', flexDirection: 'column', gap: 14, paddingBlock: 4 },
  head: { display: 'flex', alignItems: 'center', gap: 10 },
  done: { width: 22, height: 22, flexShrink: 0, color: tokens.success },
  title: { margin: 0, fontSize: 15, lineHeight: '1.4', fontWeight: 600 },
  warnings: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  warning: {
    display: 'grid',
    gridTemplateColumns: '16px minmax(0, 1fr) auto',
    alignItems: 'start',
    columnGap: 10,
    borderRadius: tokens.radiusMd,
    paddingInline: 12,
    paddingBlock: 10,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 9%, transparent)`,
    fontSize: 13,
    lineHeight: '1.25rem',
    color: tokens.foreground,
  },
  mark: { width: 16, height: 16, marginTop: 2, color: tokens.warning },
  words: { minWidth: 0, overflowWrap: 'anywhere' },
})

export function AdmissionOutcome({
  facts,
  onReview,
}: {
  facts: AdmissionOutcomeFacts
  /** open the questions some of them cannot file, and who */
  onReview?: () => void
}) {
  const { format } = useI18n()
  const cannotSubmit = facts.cannotSubmit ?? 0
  const systemAccounts = facts.systemAccounts ?? 0
  return (
    <div
      data-testid="admission-outcome"
      data-added={facts.added}
      data-cannot-submit={cannotSubmit}
      data-system-accounts={systemAccounts}
      {...stylex.props(styles.root)}
    >
      <div {...stylex.props(styles.head)}>
        <CircleCheckIcon aria-hidden {...stylex.props(styles.done)} />
        <p {...stylex.props(styles.title)}>{format(m.admittedTitle, { count: facts.added })}</p>
      </div>
      <ul {...stylex.props(styles.warnings)}>
        {cannotSubmit > 0 && (
          <li data-warning="cannot-submit" {...stylex.props(styles.warning)}>
            <TriangleAlertIcon aria-hidden {...stylex.props(styles.mark)} />
            <span {...stylex.props(styles.words)}>
              {format(m.admittedCannotSubmit, { count: cannotSubmit })}
            </span>
            {onReview !== undefined && (
              <Button size="xs" variant="outline" onClick={onReview}>
                {format(m.rosterUnreachableOpen)}
              </Button>
            )}
          </li>
        )}
        {systemAccounts > 0 && (
          <li data-warning="system-accounts" {...stylex.props(styles.warning)}>
            <TriangleAlertIcon aria-hidden {...stylex.props(styles.mark)} />
            <span {...stylex.props(styles.words)}>
              {format(m.admittedSystem, { count: systemAccounts })}
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}
