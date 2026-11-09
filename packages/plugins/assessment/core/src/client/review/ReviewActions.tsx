import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Button } from '@qualy/ui/button'
import { Count } from '@qualy/ui/count'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import * as m from '#messages'

const styles = stylex.create({
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    width: '26rem',
    maxWidth: '100%',
  },
  seat: { position: 'relative', flexShrink: 0, minHeight: '2.25rem' },
  hidden: { visibility: 'hidden' },
  bones: {
    position: 'absolute',
    inset: 0,
    height: '100%',
    width: '100%',
    borderRadius: tokens.radiusMd,
  },
})

/** The action already has a seat while the first review read is still pending. */
export function ReviewActions({
  available,
  pending,
  count,
  onStart,
  children,
}: {
  available: boolean
  pending: boolean
  count?: number
  onStart: () => void
  children?: ReactNode
}) {
  const start = (
    <div {...stylex.props(styles.seat)}>
      <Button
        data-testid="review-start"
        className={stylex.props(!available && styles.hidden).className}
        disabled={!available}
        onClick={onStart}
      >
        {m.review_runStart()}
        {count !== undefined && <Count>{count}</Count>}
      </Button>
      {!available && pending && (
        <Skeleton aria-hidden className={stylex.props(styles.bones).className} />
      )}
    </div>
  )
  return children === undefined ? (
    start
  ) : (
    <div {...stylex.props(styles.actions)}>
      {children}
      {start}
    </div>
  )
}
