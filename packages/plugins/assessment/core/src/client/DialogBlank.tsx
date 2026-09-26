import type { ReactNode } from 'react'
import { Blank } from '@qualy/ui/screen'

// What a dialog says when it has nothing to act on: somebody else settled it
// first, the reader may not see what it would list, or there was never
// anything there. The platform's compact answer - a title, a reason and,
// where there is one, the way on - named for a test to tell the answers
// apart. The dialog around it keeps one button in its footer, the one that
// closes it.

export function DialogBlank({
  icon,
  title,
  description,
  action,
  testId,
  kind,
  ...facts
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
} & { [data: `data-${string}`]: string | undefined }) {
  return (
    <div data-testid={testId ?? 'dialog-blank'} data-kind={kind} {...facts}>
      <Blank
        size="compact"
        icon={icon}
        title={title}
        {...(description !== undefined ? { description } : {})}
        {...(action !== undefined ? { action } : {})}
      />
    </div>
  )
}
