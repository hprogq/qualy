import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { AtWidth } from '@qualy/ui/at-width'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

const styles = stylex.create({
  root: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: { default: 'column', [breakpoints.desktop]: 'row' },
  },
  // The column beside the work, as wide as the shell's own rail column is
  // when it is lent: what stands in it is one thing described rather than a
  // list of places, and its longest line - where somebody stands - is the
  // one worth the room. It scrolls by itself, so the list under the facts
  // stays where it is while the work scrolls.
  column: {
    display: 'flex',
    width: 280,
    flexShrink: 0,
    flexDirection: 'column',
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
  },
  columnRoom: { minHeight: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  // Beside the column the work scrolls inside its own room; over a head it
  // is part of a page the shell scrolls.
  work: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  workBeside: { minHeight: 0 },
})

function WorkRoom({ beside, children }: { beside: boolean; children: ReactNode }) {
  return beside ? (
    <ScrollArea
      scrollsFrom="desktop"
      scrollbars="y"
      xstyle={[styles.work, styles.workBeside]}
      viewportProps={{ 'data-testid': 'participant-work' }}
    >
      {children}
    </ScrollArea>
  ) : (
    <div data-testid="participant-work" {...stylex.props(styles.work)}>
      {children}
    </div>
  )
}

/** The same room for the first streamed frame and a loaded account. */
export function ParticipantAccountLayout({
  aside,
  label,
  pending = false,
  children,
}: {
  aside?: ReactNode
  label?: string | undefined
  pending?: boolean
  children: ReactNode
}) {
  const column = aside !== undefined
  return (
    <div
      data-testid="participant-account"
      data-screen-aside={column ? '' : undefined}
      aria-busy={pending || undefined}
      {...stylex.props(styles.root)}
    >
      {column && (
        <AtWidth from={1024}>
          <aside
            data-testid="participant-column"
            aria-label={label}
            {...stylex.props(styles.column)}
          >
            <ScrollArea scrollbars="y" fill xstyle={styles.columnRoom}>
              {aside}
            </ScrollArea>
          </aside>
        </AtWidth>
      )}
      <WorkRoom beside={column}>{children}</WorkRoom>
    </div>
  )
}
