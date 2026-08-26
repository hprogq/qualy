import { memo } from 'react'
import { ChevronRightIcon, DownloadIcon, SparklesIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Kbd } from '@qualy/ui/kbd'
import { Appear } from '@qualy/ui/reveal'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentMessages as m } from '../i18n.ts'
import { AttachmentLink } from '../entry/AttachmentLink.tsx'
import { attachmentContentUrl, fieldsOf } from '../entry/model.ts'
import {
  idsOf,
  timeLabel,
  useEntryHistory,
  valueOf,
  valuesOf,
  type HistoryRevision,
  type ReviewDto,
} from './model.ts'
import { useFinePointer } from './pointer.ts'
import { Pane, type WorkbenchPart } from './Pane.tsx'

/**
 * What was actually filed, in the order it was asked for.
 *
 * The wider of the two middle columns, and the only one meant to scroll: a
 * filing is worked down item by item, and everything else on the screen is
 * there to be glanced at while doing it.
 */
// Through an anchor, not window.open: the content door names the file in
// its disposition, and a same-origin anchor with `download` saves under
// that name where a window would open one preview tab per file.
const saveAll = (attachmentIds: readonly string[]) => {
  for (const attachmentId of attachmentIds) {
    const anchor = document.createElement('a')
    anchor.href = attachmentContentUrl(attachmentId)
    anchor.download = ''
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  }
}

export const FilingColumn = memo(function FilingColumn({
  review,
  comparing,
  onCompare,
  onVersions,
  onPart,
}: {
  review: ReviewDto
  /** an earlier revision id, 'previous' for the one just before, or null */
  comparing: string | null
  onCompare: (next: string | null) => void
  onVersions: () => void
  /** the way to another face of the pager, for the summary's links */
  onPart: (part: WorkbenchPart) => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  // every field the question asks, files included and in their own places:
  // a field that asks for a certificate is not "materials", it is the
  // certificate, and folding it away left the reading order with a hole
  const fields = fieldsOf(review.form.formConfig)
  const record = (review.revision.payload ?? {}) as Record<string, unknown>
  // The version being read against. The default - the one just before this -
  // travels with the review itself, so the page's first paint already holds
  // the comparison it opens with; only a version picked by hand comes from
  // the entry's history, and the picker has that cached before anything can
  // be picked. What cannot load together would have to flash in, and this
  // screen opens comparing.
  const shipped = review.context?.previousRevision ?? null
  const wantsHistory = comparing !== null && comparing !== 'previous'
  const history = useEntryHistory(review.entryId, wantsHistory)
  // Keyed so a late fetch never performs an entrance: a fresh mount shows
  // its settled state, and only the user's own toggles animate.
  const arrived = !wantsHistory || !history.isPending
  const revisions = ((history.data as { revisions?: readonly HistoryRevision[] } | undefined)
    ?.revisions ?? []) as readonly HistoryRevision[]
  const earlier = revisions.filter((one) => one.revisionNo < review.revision.revisionNo)
  const against =
    comparing === null
      ? null
      : comparing === 'previous'
        ? shipped
        : (earlier.find((one) => one.id === comparing) ?? null)
  const was = new Map<string, { value: string; ids: readonly string[] }>(
    against === null
      ? []
      : valuesOf(against.formConfig, against.payload).map((v) => [v.key, v] as const),
  )
  const lingeringAgainst = useLingering(against)
  const changes =
    against === null
      ? 0
      : fields.filter((field) => (was.get(field.key)?.value ?? '') !== valueOf(record[field.key]))
          .length
  // The materials, numbered once across the whole filing in the order the
  // questions ask for them - the same numbers the 1-9 keys open. A file
  // taken out this version has no number: it is not one of the things to
  // look at, it is a record of what used to be.
  const slots = new Map(
    fields
      .filter((field) => field.type === 'attachment')
      .flatMap((field) => idsOf(record[field.key]))
      .map((attachmentId, index) => [attachmentId, index + 1]),
  )
  // the situation in two or three short lines, for the face that opens
  // first: which round this is, how the last one ended, what has been
  // supplemented - each a fact from the flow face, so the strip is also
  // the door to it
  const prevSaid =
    review.context?.previous == null
      ? null
      : review.context.previous.kind === 'rejected'
        ? m.reviewSummaryPrevRejected
        : review.context.previous.kind === 'revision-required'
          ? m.reviewSummaryPrevRevision
          : null
  const summaryLines: string[] = []
  if (review.chain.route === 'escalation') {
    summaryLines.push(
      `${format(m.reviewRouteEscalation)} · ${format(m.reviewSummaryRound, { round: review.roundNo })}`,
    )
  } else if (review.roundNo > 1) {
    summaryLines.push(format(m.reviewSummaryRound, { round: review.roundNo }))
  } else {
    summaryLines.push(format(m.reviewSummaryFirstRound))
  }
  if (prevSaid !== null) {
    summaryLines.push(format(prevSaid, { reason: review.context?.previous?.reason ?? 'none' }))
  }
  if (review.supplements.length > 0) {
    summaryLines.push(format(m.reviewSummarySupplemented, { count: review.supplements.length }))
  }
  return (
    <Pane
      as="main"
      part="filing"
      className="lg:border-l"
      inner="gap-4 p-5"
      footer={
        // What the machine noticed, on the pane's own floor: there whatever
        // the filing's length, so the checks always sit after the evidence,
        // never over it. The caveat is part of the block: a machine's note
        // without its error bar reads as a verdict.
        <aside className="flex shrink-0 flex-col gap-1 border-t bg-muted/30 px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <SparklesIcon
              aria-hidden
              className="size-3.5 shrink-0 text-indigo-500 dark:text-indigo-400"
            />
            <p className="text-xs font-semibold">{format(m.reviewInsight)}</p>
            <span className="flex-1" />
            <p className="text-[11px] text-muted-foreground">{format(m.reviewInsightCaveat)}</p>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {format(m.reviewInsightSoon)}
          </p>
        </aside>
      }
    >
      {/* only below lg: on a desk the flow column is in the same glance */}
      <button
        type="button"
        data-testid="filing-summary"
        onClick={() => onPart('flow')}
        className="-mt-1 flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 text-left lg:hidden"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {summaryLines.map((line, index) => (
            <span
              key={index}
              className={cn(
                'truncate',
                index === 0 ? 'text-xs font-medium' : 'text-xs text-muted-foreground',
              )}
            >
              {line}
            </span>
          ))}
        </span>
        <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <section className="flex min-h-0 flex-1 flex-col gap-3.5">
        <div className="flex flex-col border-b pb-2 max-lg:border-b-0 max-lg:pb-0">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* stacked, the strip names the part; the version and the
                compare key are what is left to say */}
            <h3 className="text-sm font-semibold max-lg:hidden">{format(m.reviewPayloadTitle)}</h3>
            <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {format(m.reviewFiledVersion, {
                no: review.revision.revisionNo,
                at: timeLabel(review.submittedAt),
              })}
            </p>
            <span className="flex-1" />
            {review.revision.revisionNo > 1 && (
              <>
                <Button
                  variant={comparing === null ? 'outline' : 'secondary'}
                  size="sm"
                  className="text-xs"
                  onClick={() => onCompare(comparing === null ? 'previous' : null)}
                >
                  {format(comparing === null ? m.reviewCompareOn : m.reviewCompareOff)}
                  {fine && <Kbd>D</Kbd>}
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={onVersions}>
                  {format(m.reviewPickVersion)}
                  {fine && <Kbd>⇧D</Kbd>}
                </Button>
              </>
            )}
          </div>
          {/* It closes over rather than leaving a blank line behind: the
              row reserved its height so nothing would jump, which traded a
              jump for a permanent gap above the rule. Collapsing gives the
              space back on the way out, so neither happens. The version it
              was reading against lingers through the exit - the sentence has
              to stay whole while it is leaving. */}
          <Appear key={String(arrived)} show={against !== null} collapse>
            <p className="pt-1.5 text-xs text-muted-foreground">
              {format(m.reviewCompareCount, {
                count: changes,
                no: lingeringAgainst?.revisionNo ?? 0,
              })}
            </p>
          </Appear>
        </div>
        <dl className="flex flex-col">
          {fields.map((field) => {
            const now = valueOf(record[field.key])
            const previous = was.get(field.key)
            const before = previous?.value ?? ''
            const changed = against !== null && before !== now
            const cited = field.type === 'attachment' ? idsOf(record[field.key]) : []
            // only while comparing: without a version to read against, a file
            // that is not here now was simply never here
            const gone =
              field.type === 'attachment'
                ? (previous?.ids ?? []).filter((one) => !cited.includes(one))
                : []
            return (
              // Stacked, and flush with the heading above: this column is
              // 1.18fr of what is left after the queue and the two rails, and
              // a fixed label gutter there costs more width than the
              // alignment buys - a long field name wrapped to three lines
              // against a one-line answer.
              <div key={field.key} className="flex flex-col gap-1.5 pb-5">
                {/* A field's name is what identifies its row, so a long one
                    wraps rather than being cut or shoved into the answer
                    beside it: "参加校级以上竞赛并获奖" truncated to its first
                    few characters names nothing. The count of files sits
                    under the name, in the same column. */}
                <dt className="flex min-w-0 items-baseline gap-2.5 text-sm text-muted-foreground">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{field.label}</span>
                  {field.type === 'attachment' && cited.length > 0 && (
                    <>
                      <span className="shrink-0 text-xs tabular-nums">
                        {format(m.reviewFilesCount, { count: cited.length })}
                      </span>
                      <span className="flex-1" />
                      {/* this field's files in a run of saves: a zip would
                          be a server-side archive nobody asked for yet */}
                      <button
                        type="button"
                        onClick={() => saveAll(cited)}
                        className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs transition-colors hover:text-foreground"
                      >
                        <DownloadIcon aria-hidden className="size-3.5" />
                        {format(m.reviewDownloadAll)}
                      </button>
                    </>
                  )}
                </dt>
                <dd className="flex min-w-0 flex-col text-base">
                  {field.type === 'attachment' ? (
                    cited.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      // the files themselves, under the field that asked for
                      // them: one flat "materials" heap at the end of the page
                      // could not say which of them was the certificate
                      <span className="flex flex-wrap gap-2">
                        {cited.map((attachmentId) => (
                          <AttachmentLink
                            key={attachmentId}
                            attachmentId={attachmentId}
                            variant="card"
                            slot={slots.get(attachmentId)}
                            mark={
                              previous !== undefined && !previous.ids.includes(attachmentId)
                                ? 'added'
                                : undefined
                            }
                          />
                        ))}
                      </span>
                    )
                  ) : (
                    <span className={cn('leading-relaxed', changed && 'font-medium')}>
                      {now === '' ? '—' : now}
                    </span>
                  )}
                  {/* What the last version had here, under what this one
                      has - the same grey line for a sentence that was
                      rewritten and for a file that was taken out. The file
                      is named and nothing more: drawn as a card among the
                      cards it would read as one of the materials on offer,
                      which is the opposite of what it is. */}
                  {field.type === 'attachment' ? (
                    <Appear key={String(arrived)} show={gone.length > 0} collapse>
                      {/* Further from the cards than they stand from each
                          other, nearer than the next field: it belongs to
                          this question, and a row of tiles is a heavy enough
                          block that a hairline gap under it reads as part of
                          the row. */}
                      <span className="flex min-w-0 flex-col gap-1 pt-3 text-xs text-muted-foreground">
                        <span className="self-start rounded bg-muted px-1.5 py-0.5">
                          {format(m.reviewFileGone)}
                        </span>
                        {gone.map((attachmentId) => (
                          // struck through, or a reviewer scanning the column
                          // reads it as one more file that is there
                          <span key={attachmentId} className="min-w-0 line-through">
                            <AttachmentLink attachmentId={attachmentId} variant="line" />
                          </span>
                        ))}
                      </span>
                    </Appear>
                  ) : (
                    <Appear key={String(arrived)} show={changed} collapse>
                      <span className="flex items-baseline gap-2 pt-1.5 text-xs text-muted-foreground">
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5">
                          {format(m.reviewComparePrevious)}
                        </span>
                        {before === '' ? (
                          <span>{format(m.reviewCompareBlank)}</span>
                        ) : (
                          <span className="min-w-0 line-through">{before}</span>
                        )}
                      </span>
                    </Appear>
                  )}
                </dd>
              </div>
            )
          })}
          {review.revision.note !== null && (
            <div className="flex flex-col gap-1.5 pb-5">
              <dt className="text-sm text-muted-foreground">{format(m.entryNote)}</dt>
              <dd className="min-w-0 text-base leading-relaxed">{review.revision.note}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* What a reviewer asked for mid-round and what came back, after the
          filing and apart from it: these questions were written by whoever
          was reviewing at the time, so they are not the item's fields and
          must not read as though the filer answered them unprompted. */}
      {review.supplements.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t pt-3">
            <p className="shrink-0 text-sm font-semibold">{format(m.reviewSupplementSection)}</p>
            <span className="flex-1" />
            <p className="text-xs text-muted-foreground">{format(m.reviewSupplementSectionNote)}</p>
          </div>
          {review.supplements.map((one) => (
            <SupplementCard key={one.id} supplement={one} />
          ))}
        </section>
      )}
    </Pane>
  )
})

/** one ask and what came back, read like the filing above it */
function SupplementCard({ supplement }: { supplement: ReviewDto['supplements'][number] }) {
  const { format } = useI18n()
  const answers = (supplement.response?.payload ?? {}) as Record<string, unknown>
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">
          {format(m.supplementRequestHeading, { no: supplement.requestNo })}
        </p>
        <Badge variant={supplement.status === 'answered' ? 'default' : 'outline'}>
          {format(
            supplement.status === 'answered'
              ? m.supplementStatusAnswered
              : supplement.status === 'cancelled'
                ? m.supplementStatusCancelled
                : m.supplementStatusOpen,
          )}
        </Badge>
        <span className="flex-1" />
        <p className="text-xs text-muted-foreground tabular-nums">
          {timeLabel(supplement.requestedAt)}
        </p>
      </div>
      <p className="border-l-2 border-border pl-2.5 text-sm leading-relaxed">
        {supplement.instructions}
      </p>
      {supplement.response !== null && (
        <dl className="flex flex-col gap-3">
          {supplement.requirements.map((asked) => {
            const value = answers[asked.key]
            return (
              <div key={asked.key} className="flex flex-col gap-1.5">
                <dt className="min-w-0 text-sm [overflow-wrap:anywhere] text-muted-foreground">
                  {asked.label}
                </dt>
                <dd className="min-w-0 text-base leading-relaxed">
                  {asked.kind === 'file' ? (
                    Array.isArray(value) && value.length > 0 ? (
                      <span className="flex flex-wrap gap-2">
                        {value.map((attachmentId) => (
                          <AttachmentLink
                            key={String(attachmentId)}
                            attachmentId={String(attachmentId)}
                            variant="card"
                            mark="supplement"
                          />
                        ))}
                      </span>
                    ) : (
                      '—'
                    )
                  ) : typeof value === 'string' && value !== '' ? (
                    value
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}
