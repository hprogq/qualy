import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useApi,
  useApiQuery,
  usePageNavigate,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Skeleton } from '@qualy/ui/skeleton'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { EvidenceForm, type EvidencePayload } from '../entry/EvidenceForm.tsx'
import { attachmentContentUrl, fieldsOf } from '../entry/model.ts'

// One submission, judged. What was filed shows exactly as the round froze
// it; the two decisions are the only writes. A rejection needs a word for
// the student and may carry a suggested version - built on the same form,
// allowed to rearrange the cited files but never to add new ones.

export default function ReviewInstancePage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.reviewDetailTab)}>
      {(batch) => <Detail batchId={batch.id} />}
    </BatchScreen>
  )
}

function Detail({ batchId }: { batchId: string }) {
  const { instanceId } = usePageRouteParams('instanceId')
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const detail = useQuery(
    query.assessment.getReviewInstance.queryOptions({ params: { instanceId } }),
  )
  const [rejecting, setRejecting] = useState(false)
  const review = detail.data?.review

  const decided = () => {
    void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
    toast.success(format(m.reviewDecided))
    navigate('assessment/batch-reviews', { params: { batchId } })
  }

  const approve = useMutation({
    mutationFn: () =>
      run(
        api.assessment.decideReview({
          params: { instanceId },
          payload: { decision: 'approve' },
        }),
      ),
    onSuccess: decided,
    onError: (error) => toast.error(formatError(error)),
  })

  return (
    <AsyncSection
      pending={detail.isPending}
      error={detail.error ? formatError(detail.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void detail.refetch()}
      skeleton={<Skeleton className="h-48 w-full" />}
    >
      {review !== undefined && (
        <div className="flex max-w-2xl flex-col gap-5">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-medium">{review.itemTitle}</h3>
              <p className="text-sm text-muted-foreground">
                {format(m.reviewSubmittedBy, {
                  name: review.participantName,
                  round: review.roundNo,
                })}
              </p>
            </div>
            {review.state === 'completed' && review.outcome !== null && (
              <Badge variant="outline">{review.outcome}</Badge>
            )}
          </header>

          <section className="rounded-lg border p-4">
            <h4 className="pb-2 text-sm font-medium">{format(m.reviewPayloadTitle)}</h4>
            <JudgedPayload payload={review.revision.payload} formConfig={review.form.formConfig} />
            {review.revision.note !== null && (
              <p className="pt-2 text-sm text-muted-foreground">{review.revision.note}</p>
            )}
            {review.revision.attachments.length > 0 && (
              <div className="pt-3">
                <p className="text-xs font-medium text-muted-foreground">{format(m.reviewFiles)}</p>
                <ul className="pt-1 text-sm">
                  {review.revision.attachments.map((attachment) => (
                    <li key={attachment.attachmentId}>
                      <a
                        className="text-primary underline-offset-2 hover:underline"
                        href={attachmentContentUrl(attachment.attachmentId)}
                        download
                      >
                        {format(m.reviewDownload)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {review.capabilities.canDecide && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejecting(true)}>
                {format(m.reviewReject)}
              </Button>
              <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                {format(m.reviewApprove)}
              </Button>
            </div>
          )}

          {rejecting && (
            <RejectDialog
              batchId={batchId}
              instanceId={instanceId}
              itemId={review.itemId}
              formConfig={review.form.formConfig}
              judgedPayload={review.revision.payload}
              onClose={() => setRejecting(false)}
              onDone={() => {
                setRejecting(false)
                decided()
              }}
            />
          )}
        </div>
      )}
    </AsyncSection>
  )
}

function JudgedPayload({ payload, formConfig }: { payload: unknown; formConfig: unknown }) {
  const fields = fieldsOf(formConfig)
  const record = (payload ?? {}) as Record<string, unknown>
  return (
    <dl className="flex flex-col gap-1 text-sm">
      {fields
        .filter((field) => field.type !== 'attachment')
        .map((field) => (
          <div key={field.key} className="flex gap-3">
            <dt className="min-w-28 text-muted-foreground">{field.label}</dt>
            <dd>{typeof record[field.key] === 'string' ? (record[field.key] as string) : '—'}</dd>
          </div>
        ))}
    </dl>
  )
}

function RejectDialog({
  batchId,
  instanceId,
  itemId,
  formConfig,
  judgedPayload,
  onClose,
  onDone,
}: {
  batchId: string
  instanceId: string
  itemId: string
  formConfig: unknown
  judgedPayload: unknown
  onClose: () => void
  onDone: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [comment, setComment] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [suggestion, setSuggestion] = useState<EvidencePayload>(
    () => (judgedPayload as EvidencePayload | null) ?? {},
  )
  const [problem, setProblem] = useState<string | null>(null)

  const reject = useMutation({
    mutationFn: () =>
      run(
        api.assessment.decideReview({
          params: { instanceId },
          payload: {
            decision: 'reject',
            comment: comment.trim(),
            ...(suggesting ? { suggestedPayload: suggestion } : {}),
          },
        }),
      ),
    onSuccess: onDone,
    onError: (error) => setProblem(formatError(error)),
  })

  return (
    <FormDialog
      open
      title={format(m.reviewRejectTitle)}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button
            disabled={reject.isPending || comment.trim() === ''}
            onClick={() => reject.mutate()}
          >
            {format(m.reviewReject)}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={format(m.reviewComment)} hint={format(m.reviewCommentHint)}>
          {(id) => (
            <Textarea
              id={id}
              value={comment}
              rows={3}
              onChange={(event) => setComment(event.target.value)}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={suggesting} onCheckedChange={(next) => setSuggesting(next === true)} />
          {format(m.reviewSuggestToggle)}
        </label>
        {suggesting && (
          <EvidenceForm
            fields={fieldsOf(formConfig).filter((field) => field.type !== 'attachment')}
            value={suggestion}
            onChange={setSuggestion}
            doors={{
              // a suggestion may never grow the evidence, so there is no
              // door to upload through here
              prepare: () => Promise.reject(new Error('suggestions cite existing files only')),
              complete: () => Promise.reject(new Error('suggestions cite existing files only')),
            }}
            where={{ batchId, itemId }}
          />
        )}
        <Feedback message={problem} />
      </div>
    </FormDialog>
  )
}
