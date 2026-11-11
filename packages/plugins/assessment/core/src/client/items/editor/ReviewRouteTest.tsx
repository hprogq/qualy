import { useState } from 'react'
import { useQuery } from '@qualy/web-runtime/query'
import { useApi, useRunApi, useLoadFailure } from '@qualy/web-runtime'
import { Button } from '@qualy/ui/button'
import { AsyncSection, FormDialog } from '@qualy/ui/admin'
import { RosterPeoplePicker } from '../../record/RosterPeoplePicker.tsx'
import { ReviewRoutes } from '../../review/ReviewRoutes.tsx'
import { assessmentApi } from '../../api.ts'
import { reviewPolicyOf, type Draft } from './model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

export function ReviewRouteTest({ batchId, draft }: { batchId: string; draft: Draft }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {m.items_testReviewRoutes()}
      </Button>
      {open && (
        <RouteTest
          batchId={batchId}
          policy={reviewPolicyOf(draft)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function RouteTest({
  batchId,
  policy,
  onClose,
}: {
  batchId: string
  policy: unknown
  onClose: () => void
}) {
  const [selected, setSelected] = useState<readonly string[]>([])
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const failures = useLoadFailure()
  const participantId = selected[0]
  const result = useQuery({
    queryKey: [
      'assessment',
      'review-route-preview',
      batchId,
      participantId,
      JSON.stringify(policy),
    ],
    queryFn: () =>
      run(
        api.assessment.previewReviewRoutes({
          params: { batchId },
          payload: { participantId: participantId!, policy },
        }),
      ),
    enabled: participantId !== undefined,
    retry: false,
  })
  return (
    <FormDialog
      open
      title={m.items_testReviewRoutes()}
      description={m.items_testReviewRoutesHint()}
      onClose={onClose}
      size="wide"
    >
      <RosterPeoplePicker
        batchId={batchId}
        value={selected}
        onChange={(next) => setSelected(next.slice(-1))}
      />
      {participantId !== undefined && (
        <AsyncSection
          pending={result.isPending}
          error={result.error === null ? null : failures.of(result.error)}
          onRetry={() => void result.refetch()}
          retrying={result.isFetching}
          retryLabel={commonMessages.action_retry()}
          loadingLabel={commonMessages.state_loading()}
        >
          {result.data !== undefined && <ReviewRoutes stages={result.data.stages} />}
        </AsyncSection>
      )}
    </FormDialog>
  )
}
