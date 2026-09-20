import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { CircleAlertIcon, XIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { assessmentMessages as m } from '../../i18n.ts'
import { ProblemRows } from './PendingList.tsx'
import type { EditorProblem } from './model.ts'

// What a refused save says, at the top of the page it was refused on.
//
// Two cards, never a banner that could be about anything. The first lists
// what the page has a place for - each line is where, what, and the way
// there - and it thins as things are corrected until it is gone. The second
// is for what the page has no place for: somebody else saved first, the
// round was archived, the scoring service is down. It says what happened,
// what that means for what was typed, and what can be done about it.
//
// White ground, a red mark, black words: the fault is in the sentence, not
// in a colour that has to be read around.

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingInline: 14,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    flexWrap: 'wrap',
  },
  mark: { display: 'inline-flex', flexShrink: 0, color: tokens.danger },
  markIcon: { width: 15, height: 15 },
  title: { fontSize: 13.5, fontWeight: 600 },
  hint: { fontSize: 12, color: tokens.mutedForeground },
  spacer: { flexGrow: 1 },
  close: { color: tokens.mutedForeground },
  loose: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingInline: 14,
    paddingBlock: 12,
    flexWrap: 'wrap',
  },
  looseWords: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '16rem',
    flexDirection: 'column',
    gap: 2,
  },
  actions: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  reasons: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 4,
  },
  reason: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 20,
    paddingInline: 7,
    borderRadius: 5,
    backgroundColor: tokens.surfaceMuted,
    fontFamily: "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace",
    fontSize: 11,
    color: tokens.mutedForeground,
  },
})

/** what the page has a place for: one line each, thinning as they are corrected */
export function FailureList({
  problems,
  onGo,
  onDismiss,
}: {
  problems: readonly EditorProblem[]
  onGo: (problem: EditorProblem) => void
  onDismiss: () => void
}) {
  const { format } = useI18n()
  if (problems.length === 0) return null
  return (
    <div {...stylex.props(styles.card)} role="alert" data-testid="save-failure" data-count={problems.length}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.mark)}>
          <CircleAlertIcon aria-hidden {...stylex.props(styles.markIcon)} />
        </span>
        <span {...stylex.props(styles.title)}>
          {format(m.itemsSaveFailedCount, { count: problems.length })}
        </span>
        <span {...stylex.props(styles.hint)}>{format(m.itemsSaveFailedHint)}</span>
        <span {...stylex.props(styles.spacer)} />
        <Button
          variant="ghost"
          size="icon-xs"
          className={stylex.props(styles.close).className}
          onClick={onDismiss}
          aria-label={format(m.itemsDismiss)}
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      <ProblemRows problems={problems} onGo={onGo} />
    </div>
  )
}

/** what the page has no place for: what happened, what it means, what can be done */
export function FailureNotice({
  kind,
  title,
  hint,
  reasons,
  actions,
}: {
  kind: string
  title: string
  hint: string
  /** the server's own reason words, for a refusal nobody has written a sentence for */
  reasons?: readonly string[]
  actions?: ReactNode
}) {
  return (
    <div {...stylex.props(styles.card)} role="alert" data-testid="save-refused" data-kind={kind}>
      <div {...stylex.props(styles.loose)}>
        <span {...stylex.props(styles.mark)}>
          <CircleAlertIcon aria-hidden {...stylex.props(styles.markIcon)} />
        </span>
        <span {...stylex.props(styles.looseWords)}>
          <span {...stylex.props(styles.title)}>{title}</span>
          <span {...stylex.props(styles.hint)}>{hint}</span>
          {reasons !== undefined && reasons.length > 0 && (
            <span {...stylex.props(styles.reasons)}>
              {reasons.map((reason) => (
                <span key={reason} {...stylex.props(styles.reason)}>
                  {reason}
                </span>
              ))}
            </span>
          )}
        </span>
        {actions !== undefined && <span {...stylex.props(styles.actions)}>{actions}</span>}
      </div>
    </div>
  )
}
