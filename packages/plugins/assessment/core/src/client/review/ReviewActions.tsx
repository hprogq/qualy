import { Button } from '@qualy/ui/button'
import { Count } from '@qualy/ui/count'
import * as m from '#messages'

export function ReviewActions({
  count,
  onStart,
  disabled = false,
}: {
  count: number
  onStart: () => void
  disabled?: boolean
}) {
  return (
    <Button data-testid="review-start" onClick={onStart} disabled={disabled}>
      {m.review_runStart()}
      <Count>{count}</Count>
    </Button>
  )
}
