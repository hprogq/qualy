import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Blank } from '@qualy/ui/screen'

// What a dialog says when it has nothing to act on: somebody else settled it
// first, the reader may not see what it would list, or there was never
// anything there. An answer with a title, a reason and, where there is one,
// the way on - at a dialog's size, not a page's, and never a bare line of
// grey text over a primary button that can do nothing.

const styles = stylex.create({
  // no frame inside the dialog's own, and room enough to read as an answer
  // rather than as a stray sentence
  inset: { minHeight: '12rem', borderWidth: 0, paddingBlock: 24, paddingInline: 16 },
})

export function DialogBlank({
  icon,
  title,
  description,
  action,
  testId,
  kind,
}: {
  icon: ReactNode
  /** what happened, in one line */
  title: string
  /** why, or what to do next */
  description?: string
  /** the one way on, when there is one */
  action?: ReactNode
  testId?: string
  /** which answer this is, for a test to tell them apart */
  kind?: string
}) {
  return (
    <div data-testid={testId ?? 'dialog-blank'} data-kind={kind}>
      <Blank
        icon={icon}
        title={title}
        {...(description !== undefined ? { description } : {})}
        {...(action !== undefined ? { action } : {})}
        xstyle={styles.inset}
      />
    </div>
  )
}
