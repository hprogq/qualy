import { memo } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, DownloadIcon, SparklesIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Kbd } from '@qualy/ui/kbd'
import { Appear } from '@qualy/ui/reveal'
import { useLingering } from '@qualy/ui/use-lingering'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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

const belowLg = '@media (max-width: 1023.98px)'
const lg = '@media (min-width: 1024px)'

const styles = stylex.create({
  frame: {
    borderLeftWidth: {
      default: 0,
      [lg]: 1,
    },
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
  },
  inner: {
    gap: 16,
    padding: 20,
  },
  insight: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 4,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 30%, transparent)`,
    paddingInline: 20,
    paddingBlock: 12,
  },
  insightHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 2,
  },
  // in the theme's own ink: the workbench is greyscale but for the two
  // verdict colours, and the machine's note is not a verdict
  insightIcon: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  insightTitle: {
    fontSize: 12,
    fontWeight: 600,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  insightCaveat: {
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  insightBody: {
    fontSize: 14,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  summary: {
    marginTop: -4,
    display: {
      default: 'flex',
      [lg]: 'none',
    },
    alignItems: 'center',
    gap: 12,
    borderRadius: tokens.radiusLg,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    paddingInline: 12,
    paddingBlock: 8,
    textAlign: 'left',
  },
  summaryLines: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 2,
  },
  summaryLine: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
  },
  summaryLead: {
    fontWeight: 500,
  },
  summaryRest: {
    color: tokens.mutedForeground,
  },
  summaryChevron: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  filing: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 14,
  },
  filingHead: {
    display: 'flex',
    flexDirection: 'column',
    borderBottomWidth: {
      default: 1,
      [belowLg]: 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingBottom: {
      default: 8,
      [belowLg]: 0,
    },
  },
  headRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  headTitle: {
    display: {
      default: null,
      [belowLg]: 'none',
    },
    fontSize: 14,
    fontWeight: 600,
  },
  filedVersion: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  xs: {
    fontSize: 12,
  },
  compareCount: {
    paddingTop: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  fieldList: {
    display: 'flex',
    flexDirection: 'column',
  },
  fieldRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    paddingBottom: 20,
  },
  fieldName: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 10,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  anywhere: {
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  filesCount: {
    flexShrink: 0,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  saveButton: {
    display: 'inline-flex',
    flexShrink: 0,
    cursor: 'pointer',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    transitionProperty: 'color',
  },
  saveIcon: {
    width: 14,
    height: 14,
  },
  fieldValue: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    fontSize: 16,
  },
  mutedInk: {
    color: tokens.mutedForeground,
  },
  fileRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  answer: {
    lineHeight: 1.625,
  },
  answerChanged: {
    fontWeight: 500,
  },
  goneBlock: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
    paddingTop: 12,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  goneTag: {
    alignSelf: 'flex-start',
    borderRadius: tokens.radiusSm,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 6,
    paddingBlock: 2,
  },
  struck: {
    minWidth: 0,
    textDecorationLine: 'line-through',
  },
  wasLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    paddingTop: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  wasTag: {
    flexShrink: 0,
    borderRadius: tokens.radiusSm,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 6,
    paddingBlock: 2,
  },
  noteName: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  proseValue: {
    minWidth: 0,
    fontSize: 16,
    lineHeight: 1.625,
  },
  supSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  supHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 10,
    rowGap: 4,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 12,
  },
  supTitle: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 600,
  },
  supNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 14,
  },
  cardHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  cardWhen: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  instructions: {
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
    paddingLeft: 10,
    fontSize: 14,
    lineHeight: 1.625,
  },
  answerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  askedRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  askedName: {
    minWidth: 0,
    fontSize: 14,
    overflowWrap: 'anywhere',
    color: tokens.mutedForeground,
  },
})

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
      xstyle={styles.frame}
      innerXstyle={styles.inner}
      footer={
        // What the machine noticed, on the pane's own floor: there whatever
        // the filing's length, so the checks always sit after the evidence,
        // never over it. The caveat is part of the block: a machine's note
        // without its error bar reads as a verdict.
        <aside {...stylex.props(styles.insight)}>
          <div {...stylex.props(styles.insightHead)}>
            <SparklesIcon aria-hidden className={stylex.props(styles.insightIcon).className} />
            <p {...stylex.props(styles.insightTitle)}>{format(m.reviewInsight)}</p>
            <span {...stylex.props(styles.spacer)} />
            <p {...stylex.props(styles.insightCaveat)}>{format(m.reviewInsightCaveat)}</p>
          </div>
          <p {...stylex.props(styles.insightBody)}>{format(m.reviewInsightSoon)}</p>
        </aside>
      }
    >
      {/* only below lg: on a desk the flow column is in the same glance */}
      <button
        type="button"
        data-testid="filing-summary"
        onClick={() => onPart('flow')}
        {...stylex.props(styles.summary)}
      >
        <span {...stylex.props(styles.summaryLines)}>
          {summaryLines.map((line, index) => (
            <span
              key={index}
              {...stylex.props(
                styles.summaryLine,
                index === 0 ? styles.summaryLead : styles.summaryRest,
              )}
            >
              {line}
            </span>
          ))}
        </span>
        <ChevronRightIcon aria-hidden className={stylex.props(styles.summaryChevron).className} />
      </button>
      <section {...stylex.props(styles.filing)}>
        <div {...stylex.props(styles.filingHead)}>
          <div {...stylex.props(styles.headRow)}>
            {/* stacked, the strip names the part; the version and the
                compare key are what is left to say */}
            <h3 {...stylex.props(styles.headTitle)}>{format(m.reviewPayloadTitle)}</h3>
            <p {...stylex.props(styles.filedVersion)}>
              {format(m.reviewFiledVersion, {
                no: review.revision.revisionNo,
                at: timeLabel(review.submittedAt),
              })}
            </p>
            <span {...stylex.props(styles.spacer)} />
            {review.revision.revisionNo > 1 && (
              <>
                <Button
                  variant={comparing === null ? 'outline' : 'secondary'}
                  size="sm"
                  className={stylex.props(styles.xs).className}
                  onClick={() => onCompare(comparing === null ? 'previous' : null)}
                >
                  {format(comparing === null ? m.reviewCompareOn : m.reviewCompareOff)}
                  {fine && <Kbd>D</Kbd>}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={stylex.props(styles.xs).className}
                  onClick={onVersions}
                >
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
            <p {...stylex.props(styles.compareCount)}>
              {format(m.reviewCompareCount, {
                count: changes,
                no: lingeringAgainst?.revisionNo ?? 0,
              })}
            </p>
          </Appear>
        </div>
        <dl {...stylex.props(styles.fieldList)}>
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
              <div key={field.key} {...stylex.props(styles.fieldRow)}>
                {/* A field's name is what identifies its row, so a long one
                    wraps rather than being cut or shoved into the answer
                    beside it: "参加校级以上竞赛并获奖" truncated to its first
                    few characters names nothing. The count of files sits
                    under the name, in the same column. */}
                <dt {...stylex.props(styles.fieldName)}>
                  <span {...stylex.props(styles.anywhere)}>{field.label}</span>
                  {field.type === 'attachment' && cited.length > 0 && (
                    <>
                      <span {...stylex.props(styles.filesCount)}>
                        {format(m.reviewFilesCount, { count: cited.length })}
                      </span>
                      <span {...stylex.props(styles.spacer)} />
                      {/* this field's files in a run of saves: a zip would
                          be a server-side archive nobody asked for yet */}
                      <button
                        type="button"
                        onClick={() => saveAll(cited)}
                        {...stylex.props(styles.saveButton)}
                      >
                        <DownloadIcon
                          aria-hidden
                          className={stylex.props(styles.saveIcon).className}
                        />
                        {format(m.reviewDownloadAll)}
                      </button>
                    </>
                  )}
                </dt>
                <dd {...stylex.props(styles.fieldValue)}>
                  {field.type === 'attachment' ? (
                    cited.length === 0 ? (
                      <span {...stylex.props(styles.mutedInk)}>—</span>
                    ) : (
                      // the files themselves, under the field that asked for
                      // them: one flat "materials" heap at the end of the page
                      // could not say which of them was the certificate
                      <span {...stylex.props(styles.fileRow)}>
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
                    <span {...stylex.props(styles.answer, changed && styles.answerChanged)}>
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
                      <span {...stylex.props(styles.goneBlock)}>
                        <span {...stylex.props(styles.goneTag)}>{format(m.reviewFileGone)}</span>
                        {gone.map((attachmentId) => (
                          // struck through, or a reviewer scanning the column
                          // reads it as one more file that is there
                          <span key={attachmentId} {...stylex.props(styles.struck)}>
                            <AttachmentLink attachmentId={attachmentId} variant="line" />
                          </span>
                        ))}
                      </span>
                    </Appear>
                  ) : (
                    <Appear key={String(arrived)} show={changed} collapse>
                      <span {...stylex.props(styles.wasLine)}>
                        <span {...stylex.props(styles.wasTag)}>
                          {format(m.reviewComparePrevious)}
                        </span>
                        {before === '' ? (
                          <span>{format(m.reviewCompareBlank)}</span>
                        ) : (
                          <span {...stylex.props(styles.struck)}>{before}</span>
                        )}
                      </span>
                    </Appear>
                  )}
                </dd>
              </div>
            )
          })}
          {review.revision.note !== null && (
            <div {...stylex.props(styles.fieldRow)}>
              <dt {...stylex.props(styles.noteName)}>{format(m.entryNote)}</dt>
              <dd {...stylex.props(styles.proseValue)}>{review.revision.note}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* What a reviewer asked for mid-round and what came back, after the
          filing and apart from it: these questions were written by whoever
          was reviewing at the time, so they are not the item's fields and
          must not read as though the filer answered them unprompted. */}
      {review.supplements.length > 0 && (
        <section {...stylex.props(styles.supSection)}>
          <div {...stylex.props(styles.supHead)}>
            <p {...stylex.props(styles.supTitle)}>{format(m.reviewSupplementSection)}</p>
            <span {...stylex.props(styles.spacer)} />
            <p {...stylex.props(styles.supNote)}>{format(m.reviewSupplementSectionNote)}</p>
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
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHead)}>
        <p {...stylex.props(styles.cardTitle)}>
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
        <span {...stylex.props(styles.spacer)} />
        <p {...stylex.props(styles.cardWhen)}>{timeLabel(supplement.requestedAt)}</p>
      </div>
      <p {...stylex.props(styles.instructions)}>{supplement.instructions}</p>
      {supplement.response !== null && (
        <dl {...stylex.props(styles.answerList)}>
          {supplement.requirements.map((asked) => {
            const value = answers[asked.key]
            return (
              <div key={asked.key} {...stylex.props(styles.askedRow)}>
                <dt {...stylex.props(styles.askedName)}>{asked.label}</dt>
                <dd {...stylex.props(styles.proseValue)}>
                  {asked.kind === 'file' ? (
                    Array.isArray(value) && value.length > 0 ? (
                      <span {...stylex.props(styles.fileRow)}>
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
