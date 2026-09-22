import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Card } from '@qualy/ui/card'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// The frame the pages reached from a mail link stand in: one card in the
// middle of an otherwise empty screen, like the sign-in page they lead to.

const styles = stylex.create({
  ground: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    padding: 16,
  },
  door: { width: '100%', maxWidth: 384 },
  title: { marginBottom: 16, textAlign: 'center', fontSize: 20, fontWeight: 500 },
  body: { display: 'flex', flexDirection: 'column', gap: 16 },
})

export function Door({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.ground)}>
      <Card xstyle={styles.door}>
        <h1 {...stylex.props(styles.title)}>{title}</h1>
        <div {...stylex.props(styles.body)}>{children}</div>
      </Card>
    </div>
  )
}
