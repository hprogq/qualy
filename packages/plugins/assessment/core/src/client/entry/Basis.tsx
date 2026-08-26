import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'

// The clause a section or a question is scored against.
//
// Reserved, not written: nothing in the round carries the wording yet, so
// the block holds its place and says what will stand here rather than
// leaving the pane to be rebuilt around it later.

const styles = stylex.create({
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    padding: 16,
  },
  blockCompact: {
    padding: 14,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
  },
  clause: {
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
    paddingLeft: 12,
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
})

export function Basis({ compact = false }: { compact?: boolean }) {
  const { format } = useI18n()
  return (
    <section {...stylex.props(styles.block, compact && styles.blockCompact)}>
      <p {...stylex.props(styles.title)}>{format(m.myEntriesBasis)}</p>
      <p {...stylex.props(styles.clause)}>{format(m.myEntriesBasisSoon)}</p>
    </section>
  )
}
