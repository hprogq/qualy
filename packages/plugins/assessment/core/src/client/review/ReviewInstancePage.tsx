import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useApi,
  useApiQuery,
  usePageNavigate,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import type { MessageDescriptor } from '@qualy/i18n-contract'
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
import { fieldsOf } from '../entry/model.ts'
import { AttachmentLink } from '../entry/AttachmentLink.tsx'
import { reviewEventMessage, reviewOutcomeMessage } from './events.ts'

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
  const { format, formatError, locale } = useI18n()
  // names in a row are punctuated the way the reader's language punctuates a
  // list, which is not the same mark in every one
  const listed = useMemo(
    () => new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }),
    [locale],
  )
  const detail = useQuery(
    query.assessment.getReviewInstance.queryOptions({ params: { instanceId } }),
  )
  const [saying, setSaying] = useState<string | null>(null)
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
        <div className="flex flex-col gap-5">
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
              <Badge variant="outline">{format(reviewOutcomeMessage(review.outcome))}</Badge>
            )}
          </header>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <section className="rounded-lg border p-4">
              <h4 className="pb-3 text-sm font-medium">{format(m.reviewPayloadTitle)}</h4>
              <JudgedPayload
                payload={review.revision.payload}
                formConfig={review.form.formConfig}
              />
              {review.revision.note !== null && (
                <p className="pt-3 text-sm text-muted-foreground">{review.revision.note}</p>
              )}
              {review.revision.attachments.length > 0 && (
                <div className="pt-4">
                  <p className="pb-1 text-xs font-medium text-muted-foreground">
                    {format(m.reviewFiles)}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {review.revision.attachments.map((attachment) => (
                      <li key={attachment.attachmentId}>
                        <AttachmentLink attachmentId={attachment.attachmentId} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <aside className="flex flex-col gap-4">
              <section className="rounded-lg border p-4 text-sm">
                <dl className="flex flex-col gap-2">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{format(m.reviewApplicant)}</dt>
                    <dd className="font-medium">{review.participantName}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{format(m.reviewRound)}</dt>
                    <dd>{review.roundNo}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{format(m.reviewSubmittedAt)}</dt>
                    <dd>{new Date(review.submittedAt).toLocaleString()}</dd>
                  </div>
                </dl>
              </section>
              <section className="rounded-lg border p-4">
                <p className="pb-2 text-xs font-medium text-muted-foreground">
                  {format(m.reviewChainTitle)}
                </p>
                {/* two routes, drawn as two: the doubt one is not the tail
                    of the ordinary one and never was somewhere a submission
                    walks on its way through */}
                <Route
                  title={format(m.reviewRouteNormal)}
                  stages={review.chain.normal}
                  here={review.chain.route === 'normal' ? review.chain.stageId : null}
                />
                {review.chain.doubt.length > 0 && (
                  <Route
                    title={format(m.reviewRouteDoubt)}
                    stages={review.chain.doubt}
                    here={review.chain.route === 'doubt' ? review.chain.stageId : null}
                  />
                )}
              </section>
              {review.events.length > 0 && (
                <section className="rounded-lg border p-4">
                  <p className="pb-2 text-xs font-medium text-muted-foreground">
                    {format(m.reviewTrail)}
                  </p>
                  <ul className="flex flex-col gap-2 text-sm">
                    {review.events.map((event, index) => {
                      const said = reviewEventMessage(event.kind)
                      return (
                        <li key={index}>
                          <p>
                            {format(
                              said.message,
                              said.needsActor
                                ? { who: event.actorName ?? format(m.eventSomebody) }
                                : {},
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(event.at).toLocaleString()}
                          </p>
                          {event.comment !== null && <p className="pt-0.5">{event.comment}</p>}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
            </aside>
          </div>

          {review.chain.route === 'doubt' && (
            <p className="text-sm text-muted-foreground">{format(m.reviewOnDoubtRoute)}</p>
          )}
          {review.chain.decisions.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {review.chain.decisions
                .filter((decision) => decision !== 'approve')
                .map((decision) => (
                  <Button key={decision} variant="outline" onClick={() => setSaying(decision)}>
                    {format(SAYINGS[decision] ?? m.reviewCommentAction)}
                  </Button>
                ))}
              {review.chain.decisions.includes('approve') && (
                <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                  {format(m.reviewApprove)}
                </Button>
              )}
            </div>
          )}

          {saying !== null && (
            <SayDialog
              batchId={batchId}
              instanceId={instanceId}
              itemId={review.itemId}
              decision={saying}
              formConfig={review.form.formConfig}
              judgedPayload={review.revision.payload}
              onClose={() => setSaying(null)}
              onDone={() => {
                setSaying(null)
                // an opinion moves nothing: the round stays where it is and
                // so does the reader, with the new word already in the trail
                if (saying === 'comment' || saying.startsWith('recommend-')) {
                  void detail.refetch()
                  toast.success(format(m.reviewSaid))
                  return
                }
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

/** one route, in order, with the step this round is standing at marked */
function Route({
  title,
  stages,
  here,
}: {
  title: string
  stages: readonly {
    id: string
    nodeName: string | null
    roleNames: readonly string[]
    reviewers: readonly string[] | null
    skipped: string | null
  }[]
  /** the step being stood at, or null when the round is on the other route */
  here: string | null
}) {
  const { format, locale } = useI18n()
  const listed = new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' })
  return (
    <div className="flex flex-col gap-1 pt-1 first:pt-0">
      <p className="px-2 text-xs font-medium text-muted-foreground">{title}</p>
      <ol className="flex flex-col gap-2 text-sm">
        {stages.map((stage) => (
          <li
            key={stage.id}
            className={stage.id === here ? 'rounded-md bg-accent/60 px-2 py-1' : 'px-2 py-1'}
          >
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">
                {stage.nodeName ??
                  format(
                    stage.skipped === 'no-holder' ? m.reviewStageNoHolder : m.reviewStageSkipped,
                  )}
              </span>
              {stage.id === here && (
                <span className="text-xs text-primary">{format(m.reviewStageHere)}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{listed.format(stage.roleNames)}</p>
            {stage.nodeName !== null && stage.reviewers !== null && (
              <p className="text-xs text-muted-foreground">
                {stage.reviewers.length === 0
                  ? format(m.reviewStageNobody)
                  : format(m.reviewStageReviewers, { who: listed.format(stage.reviewers) })}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** what each decision is called on a button and at the top of its dialog */
const SAYINGS: Record<string, MessageDescriptor> = {
  reject: m.reviewReject,
  'raise-doubt': m.reviewRaiseDoubt,
  comment: m.reviewCommentAction,
}

/**
 * Everything a reviewer says except a plain approval: a word is required,
 * and a rejection may carry a suggested version of the filing.
 */
function SayDialog({
  batchId,
  instanceId,
  itemId,
  decision,
  formConfig,
  judgedPayload,
  onClose,
  onDone,
}: {
  batchId: string
  instanceId: string
  itemId: string
  decision: string
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

  const say = useMutation({
    mutationFn: () =>
      run(
        api.assessment.decideReview({
          params: { instanceId },
          payload: {
            decision: decision as 'reject',
            comment: comment.trim(),
            ...(suggesting && decision === 'reject' ? { suggestedPayload: suggestion } : {}),
          },
        }),
      ),
    onSuccess: onDone,
    onError: (error) => setProblem(formatError(error)),
  })

  return (
    <FormDialog
      open
      title={format(SAYINGS[decision] ?? m.reviewSayTitle)}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={say.isPending || comment.trim() === ''} onClick={() => say.mutate()}>
            {format(SAYINGS[decision] ?? m.reviewSayTitle)}
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
        {suggesting && decision === 'reject' && (
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
