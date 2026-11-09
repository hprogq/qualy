import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Card } from '@qualy/ui/screen'
import { Stagger } from '@qualy/ui/reveal'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// Nothing in the queue, said as a card where the list would stand: the same
// ground as the work it stands in for, tall enough to read as a place
// rather than a line someone forgot to fill.

const styles = stylex.create({
  card: {
    display: 'flex',
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: 24,
    paddingBlock: 56,
  },
  stack: {
    display: 'flex',
    maxWidth: '28rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    textAlign: 'center',
  },
  badge: {
    display: 'flex',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    borderRadius: 999,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.mutedForeground,
  },
  badgeOk: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 14%, ${tokens.surface})`,
    color: tokens.successForeground,
  },
  title: { margin: 0, fontSize: 17, lineHeight: 1.4, fontWeight: 600 },
  body: {
    margin: 0,
    fontSize: 13.5,
    lineHeight: 1.6,
    textWrap: 'pretty',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.surfaceMutedForeground,
  },
  hint: { margin: 0, marginTop: 6, fontSize: 12.5, color: tokens.mutedForeground },
  action: { marginTop: 10 },
})

export function QueueEmpty({
  state,
  tone = 'plain',
  icon,
  title,
  body,
  hint,
  action,
}: {
  /** which kind of empty this is, for the hooks a test reads it by */
  state: string
  /** ok where the emptiness was earned: everything handled */
  tone?: 'plain' | 'ok'
  icon: ReactNode
  title: string
  body?: string
  /** a quieter line under the body: what happens next */
  hint?: string
  /** the one thing to do about it, where there is one */
  action?: ReactNode
}) {
  return (
    <Card xstyle={styles.card} data-testid="review-inbox-empty" data-empty={state}>
      <Stagger className={stylex.props(styles.stack).className} step={0.06}>
        <span {...stylex.props(styles.badge, tone === 'ok' && styles.badgeOk)}>{icon}</span>
        <h2 {...stylex.props(styles.title)}>{title}</h2>
        {body !== undefined && <p {...stylex.props(styles.body)}>{body}</p>}
        {hint !== undefined && <p {...stylex.props(styles.hint)}>{hint}</p>}
        {action !== undefined && <div {...stylex.props(styles.action)}>{action}</div>}
      </Stagger>
    </Card>
  )
}
