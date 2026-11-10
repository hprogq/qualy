import { Button } from '@qualy/ui/button'
import { Count } from '@qualy/ui/count'
import * as m from '#messages'

export function ReviewActions({ count, onStart }: { count: number; onStart: () => void }) {
  return (
    <Button data-testid="review-start" onClick={onStart}>
      {m.review_runStart()}
      <Count>{count}</Count>
    </Button>
  )
}
