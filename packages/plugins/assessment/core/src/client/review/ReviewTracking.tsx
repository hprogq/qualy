import { useState } from 'react'
import { useQuery } from '@qualy/web-runtime/query'
import { useApiQuery } from '@qualy/web-runtime'
import { Button } from '@qualy/ui/button'
import { SidePanel } from '@qualy/ui/admin'
import { ReviewRoutes } from './ReviewRoutes.tsx'
import { assessmentApi } from '../api.ts'
import * as m from '#messages'

export function ReviewTracking({ entryId }: { entryId: string }) {
  const query = useApiQuery(assessmentApi)
  const [open, setOpen] = useState(false)
  const result = useQuery({
    ...query.assessment.getReviewTracking.queryOptions({ params: { entryId } }),
    staleTime: 15_000,
    refetchInterval: open ? 30_000 : false,
    retry: false,
  })
  if (result.data?.available !== true) return null
  const tracking = result.data
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {m.review_trackingTitle()}
      </Button>
      <SidePanel open={open} title={m.review_trackingTitle()} onClose={() => setOpen(false)}>
        {tracking.state === 'awaiting_supplement' && (
          <p role="status">{m.review_trackingWaitingSupplement()}</p>
        )}
        {tracking.stages.length === 0 ? (
          <p>{m.review_trackingConcluded()}</p>
        ) : (
          <ReviewRoutes stages={tracking.stages} currentOnly />
        )}
      </SidePanel>
    </>
  )
}
