import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { AlertCircleIcon, XIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Badge } from '@qualy/ui/badge'
import { Breadcrumb } from '@qualy/ui/breadcrumb'
import { Button } from '@qualy/ui/button'
import { Swap } from '@qualy/ui/reveal'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Count } from '@qualy/ui/count'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { AttachmentLink } from './AttachmentLink.tsx'
import { EntryTrail } from './EntryHistory.tsx'
import { EntryStanding } from './EntryStanding.tsx'
import { displayValueOf, fieldsOf, type EntryDto, type ItemDto } from './model.ts'

// One claim, in full, in a drawer over the list it came from.
//
// Not a dialog and not a page of its own: a dialog would cover the sibling
// claims it is being read against, and a page costs a journey there and back
// for what is one claim on the same question. The drawer keeps the list
// behind it and closes in place. Everything the card does not say lives
// here - every field, the refusal in full, the reviewer's asks with what
// answered them, the whole account.
//
// Reading it is one thing; what may be DONE about it is not. The owner
// hands the claim on, takes it back or gives it up; whoever administers the
// round sends it back for revision or takes an administrative determination
// off it. Those are different acts answering to different permissions, and
// neither of them is a reason to have two descriptions of the same claim.
// So the surface is here, once, and the acts arrive as a footer.

const styles = stylex.create({
  panel: {
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
    gap: 0,
    padding: 0,
    maxWidth: { default: null, [breakpoints.tablet]: '48rem', [breakpoints.desktop]: '48rem' },
  },
  sheetTitle: { flexShrink: 0, fontSize: 16, lineHeight: '1.5rem', fontWeight: 600 },
  crumbHere: {
    color: tokens.foreground,
  },
  head: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'flex-start',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 16,
  },
  headWords: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
  },
  titleRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  versionNote: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  tabBar: {
    display: 'flex',
    flexShrink: 0,
    gap: 2,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 20,
  },
  tab: {
    position: 'relative',
    display: 'inline-flex',
    height: 36,
    alignItems: 'center',
    gap: 6,
    paddingInline: 10,
    fontSize: 14,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  tabOn: {
    fontWeight: 500,
    color: tokens.foreground,
  },
  tabInk: {
    position: 'absolute',
    insetInline: 8,
    bottom: -1,
    height: 2,
    backgroundColor: tokens.foreground,
  },
  scroller: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    paddingInline: 20,
    paddingBlock: 16,
  },
  // why it came back, first: it is the reason this drawer was opened at
  // all when the claim is waiting on its owner
  notice: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    backgroundColor: tokens.surfaceMuted,
    padding: 12,
  },
  noticeAsk: {
    gap: 10,
  },
  noticeHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 8,
  },
  noticeTitle: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 600,
    color: tokens.danger,
  },
  reasonBadge: {
    backgroundColor: tokens.background,
    fontWeight: 400,
  },
  noticeWhen: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  prose: {
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
  },
  suggested: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 8,
  },
  quietNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  suggestedLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 14,
  },
  keepShort: {
    flexShrink: 0,
  },
  suggestedLabel: {
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  anywhere: {
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  askHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  askIcon: {
    width: 16,
    height: 16,
    flexShrink: 0,
    color: tokens.danger,
  },
  askTitle: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    fontSize: 14,
    fontWeight: 500,
  },
  askNeeds: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 10,
  },
  askPiece: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
  },
  askDot: {
    width: 4,
    height: 4,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  askPieceName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  askPieceKind: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  askPieceRequired: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.danger,
  },
  // what was filed, whole: the card's three lines are a reminder, this is
  // the filing
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
  },
  sectionTitle: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 600,
    color: tokens.mutedForeground,
  },
  sectionRule: {
    height: 1,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    backgroundColor: tokens.border,
  },
  sectionNote: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  fieldLabel: {
    fontSize: 13,
    overflowWrap: 'anywhere',
    color: tokens.mutedForeground,
  },
  fieldValue: {
    fontSize: 15,
    lineHeight: 1.625,
    overflowWrap: 'anywhere',
  },
  fieldCleared: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  fileRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  supAsk: {
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: 14,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  // The acts, once, where the whole claim is on screen: quitting on the
  // far left where it cannot be pressed for one of the others, and handing
  // on - the act that moves things - carrying the ink.
  actionBar: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 12,
  },
  ghostInk: {
    color: tokens.mutedForeground,
  },
  noPointer: {
    pointerEvents: 'none',
  },
})

type History = ApiResult<typeof assessmentApi, 'assessment', 'getEntryHistory'>

/**
 * The rewrite the reviewer proposed, next to the sentence that sent the
 * claim back: only the fields that would change, shown for the owner to
 * apply by hand - the form never fills itself from a reviewer's words.
 */
function SuggestedChanges({
  suggested,
  payload,
  fields,
}: {
  suggested: unknown
  payload: Record<string, unknown>
  fields: ReturnType<typeof fieldsOf>
}) {
  const { format } = useI18n()
  if (suggested === null || typeof suggested !== 'object') return null
  const record = suggested as Record<string, unknown>
  const rows = fields.filter(
    (field) =>
      field.type !== 'attachment' &&
      field.key in record &&
      String(record[field.key] ?? '') !== String(payload[field.key] ?? ''),
  )
  if (rows.length === 0) return null
  return (
    <div {...stylex.props(styles.suggested)} data-testid="suggested-changes">
      <p {...stylex.props(styles.quietNote)}>{format(m.entrySuggestedTitle)}</p>
      {rows.map((field) => {
        const said = displayValueOf(field, record[field.key], {
          yes: format(m.recognitionYes),
          no: format(m.recognitionNo),
        })
        return (
          <p key={field.key} {...stylex.props(styles.suggestedLine)}>
            <span {...stylex.props(styles.suggestedLabel)}>{field.label}</span>
            <span {...stylex.props(styles.anywhere)}>{said === '' ? '–' : said}</span>
          </p>
        )
      })}
    </div>
  )
}

export function EntryDetail({
  open,
  entry,
  item,
  trail,
  onClose,
  onSupplement,
  aside,
  footer,
}: {
  open: boolean
  entry: EntryDto
  item: ItemDto
  /** the groups above the question, outermost first */
  trail: readonly string[]
  onClose: () => void
  /** answering the open ask, when the reader is the one being asked */
  onSupplement?: () => void
  /** said before the claim's own fields: what a staff reader needs first */
  aside?: ReactNode
  /** the acts, which belong to whoever opened this and not to the claim */
  footer?: ReactNode
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const yesNo = { yes: format(m.recognitionYes), no: format(m.recognitionNo) }
  const [tab, setTab] = useState<'content' | 'trail'>('content')
  const payload = (entry.currentRevision?.payload ?? {}) as Record<string, unknown>
  const revisionNo = entry.currentRevision?.revisionNo
  const declared = item.itemType === 'declaration'
  // the same read the trail tab makes; the answered asks in the content tab
  // come from it, so the two tabs cannot tell different stories
  const history = useQuery({
    ...query.assessment.getEntryHistory.queryOptions({ params: { entryId: entry.id } }),
    enabled: open,
  })
  const rounds = ((history.data as History | undefined)?.rounds ?? []) as History['rounds']
  const answered = rounds.flatMap((round) =>
    round.supplements
      .filter((one) => one.status === 'answered' && one.response !== null)
      .map((one) => ({ ...one, roundNo: round.roundNo })),
  )
  const versions = (history.data as History | undefined)?.revisions.length ?? 0
  // Read back against the form this version was written under, not the one
  // the question carries today. An administrator editing the question after
  // somebody filed moved answers out from under the reader: a field since
  // removed took a filed answer off the screen entirely, and a field since
  // added showed as cleared though nobody was ever asked it. The two are the
  // same object whenever nothing changed, which is the ordinary case and
  // needs no waiting; where they differ, the fields wait for the history
  // rather than showing the wrong ones in the meantime.
  const filedUnder = ((history.data as History | undefined)?.revisions ?? []).find(
    (one) => one.id === entry.currentRevision?.id,
  )
  const fields = fieldsOf(
    entry.currentRevision?.itemRevisionId === item.currentRevision?.id
      ? item.currentRevision?.formConfig
      : (filedUnder?.formConfig ?? null),
  )

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent xstyle={styles.panel} showCloseButton={false}>
        <div {...stylex.props(styles.head)}>
          <div {...stylex.props(styles.headWords)}>
            <Breadcrumb>
              {trail.map((name, index) => (
                <span key={index}>{name}</span>
              ))}
              <span aria-current="page" {...stylex.props(styles.crumbHere)}>
                {item.title}
              </span>
            </Breadcrumb>
            <div {...stylex.props(styles.titleRow)}>
              <SheetTitle className={stylex.props(styles.sheetTitle).className}>
                {format(m.entrySheetTitle)}
              </SheetTitle>
              <EntryStanding
                status={entry.status}
                source={entry.source}
                revised={entry.currentReviewInstanceId !== null}
                asked={entry.supplement !== null}
              />
              {revisionNo !== undefined && entry.status !== 'draft' && (
                <span {...stylex.props(styles.versionNote)}>
                  {format(m.entryVersionNo, { no: revisionNo })}
                </span>
              )}
            </div>
          </div>
          <span {...stylex.props(styles.spacer)} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={format(commonMessages.close)}
            onClick={onClose}
          >
            <XIcon aria-hidden />
          </Button>
        </div>

        <div {...stylex.props(styles.tabBar)}>
          {(
            [
              [
                'content',
                m.entrySheetContent,
                format(m.entrySheetContentCount, { count: fields.length }),
              ],
              ['trail', m.entrySheetTrail, format(m.entrySheetTrailCount, { count: versions })],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              {...stylex.props(styles.tab, tab === key && styles.tabOn)}
            >
              {format(label)}
              <Count>{count}</Count>
              {tab === key && <span aria-hidden {...stylex.props(styles.tabInk)} />}
            </button>
          ))}
        </div>

        <ScrollArea className={stylex.props(styles.scroller).className}>
          {/* the two tabs replace each other in place, seen to change */}
          <Swap swapKey={tab} className={stylex.props(styles.body).className}>
            {tab === 'trail' ? (
              <EntryTrail entryId={entry.id} />
            ) : (
              <>
                {aside}
                {entry.refusal !== null && (
                  <div {...stylex.props(styles.notice)}>
                    <div {...stylex.props(styles.noticeHead)}>
                      <p {...stylex.props(styles.noticeTitle)}>
                        {format(
                          entry.refusal.kind === 'rejected'
                            ? m.entryRefusedTitle
                            : m.entryReturnedTitle,
                        )}
                      </p>
                      {entry.refusal.reason !== null && (
                        <Badge
                          variant="outline"
                          className={stylex.props(styles.reasonBadge).className}
                        >
                          {entry.refusal.reason}
                        </Badge>
                      )}
                      <span {...stylex.props(styles.spacer)} />
                      <span {...stylex.props(styles.noticeWhen)}>
                        {new Date(entry.refusal.at).toLocaleString()}
                      </span>
                    </div>
                    {(entry.refusal.comment ?? '') !== '' && (
                      <div>
                        <p {...stylex.props(styles.fieldLabel)}>{format(m.reviewComment)}</p>
                        <p {...stylex.props(styles.prose)}>{entry.refusal.comment}</p>
                      </div>
                    )}
                    <SuggestedChanges
                      suggested={entry.refusal.suggestedPayload}
                      payload={payload}
                      fields={fields}
                    />
                  </div>
                )}

                {/* the open ask, with its answer one press away */}
                {entry.supplement !== null && (
                  <div
                    data-testid="supplement-ask"
                    {...stylex.props(styles.notice, styles.noticeAsk)}
                  >
                    <div {...stylex.props(styles.askHead)}>
                      <AlertCircleIcon
                        aria-hidden
                        className={stylex.props(styles.askIcon).className}
                      />
                      <p {...stylex.props(styles.askTitle)}>{format(m.entrySupplementTitle)}</p>
                    </div>
                    <p {...stylex.props(styles.prose)}>{entry.supplement.instructions}</p>
                    {entry.supplement.requirements.length > 0 && (
                      <div {...stylex.props(styles.askNeeds)}>
                        <p {...stylex.props(styles.quietNote)}>{format(m.supplementNeeds)}</p>
                        {entry.supplement.requirements.map((asked) => (
                          <span key={asked.key} {...stylex.props(styles.askPiece)}>
                            <span aria-hidden {...stylex.props(styles.askDot)} />
                            <span {...stylex.props(styles.askPieceName)}>{asked.label}</span>
                            <span {...stylex.props(styles.askPieceKind)}>
                              {format(
                                asked.kind === 'file' ? m.supplementAddFile : m.supplementAddText,
                              )}
                            </span>
                            {asked.required && (
                              <span {...stylex.props(styles.askPieceRequired)}>
                                {format(m.supplementPieceRequired)}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    <Button
                      size="sm"
                      disabled={onSupplement === undefined}
                      onClick={() => onSupplement?.()}
                    >
                      {format(m.entrySupplementAnswer)}
                    </Button>
                  </div>
                )}

                <section {...stylex.props(styles.section)}>
                  <div {...stylex.props(styles.sectionHead)}>
                    {/* what this section holds depends on how the fact
                        arrived, not on what kind of question it answers:
                        an item may accept both a claim and a record */}
                    <p {...stylex.props(styles.sectionTitle)}>
                      {format(
                        entry.source === 'record' || entry.source === 'import'
                          ? m.entrySheetRecorded
                          : m.entrySheetOwn,
                      )}
                    </p>
                    <span aria-hidden {...stylex.props(styles.sectionRule)} />
                    {revisionNo !== undefined && (
                      <p {...stylex.props(styles.sectionNote)}>
                        {format(m.entryVersionNo, { no: revisionNo })}
                      </p>
                    )}
                  </div>
                  {fields.map((field) => {
                    const value = payload[field.key]
                    return (
                      <div key={field.key} {...stylex.props(styles.field)}>
                        <p {...stylex.props(styles.fieldLabel)}>{field.label}</p>
                        {field.type === 'attachment' ? (
                          Array.isArray(value) && value.length > 0 ? (
                            <span {...stylex.props(styles.fileRow)}>
                              {value.map((id) => (
                                <AttachmentLink
                                  key={String(id)}
                                  attachmentId={String(id)}
                                  variant="card"
                                />
                              ))}
                            </span>
                          ) : (
                            <p {...stylex.props(styles.fieldCleared)}>
                              {format(m.entryFieldCleared)}
                            </p>
                          )
                        ) : (
                          <p {...stylex.props(styles.fieldValue)}>
                            {displayValueOf(field, value, yesNo) || format(m.entryFieldCleared)}
                          </p>
                        )}
                      </div>
                    )
                  })}
                  {(entry.currentRevision?.note ?? null) !== null && (
                    <div {...stylex.props(styles.field)}>
                      <p {...stylex.props(styles.fieldLabel)}>
                        {format(
                          entry.source === 'record' || entry.source === 'import'
                            ? m.entryRecordBasis
                            : m.entryNote,
                        )}
                      </p>
                      <p {...stylex.props(styles.fieldValue)}>{entry.currentRevision!.note}</p>
                    </div>
                  )}
                </section>

                {/* what a reviewer asked for and what answered it, one
                    section per ask: the requirement and the material stay
                    together, because apart neither says what it is for */}
                {answered.map((ask) => (
                  <section key={ask.id} {...stylex.props(styles.section)}>
                    <div {...stylex.props(styles.sectionHead)}>
                      <p {...stylex.props(styles.sectionTitle)}>{format(m.entrySheetSupHead)}</p>
                      <span aria-hidden {...stylex.props(styles.sectionRule)} />
                      <p {...stylex.props(styles.sectionNote)}>
                        {format(m.entrySheetSupNote, {
                          round: ask.roundNo,
                          asked: timeOf(ask.requestedAt),
                          answered: timeOf(ask.response!.respondedAt),
                        })}
                      </p>
                    </div>
                    <p {...stylex.props(styles.supAsk)}>
                      {format(m.entrySheetSupAsk)}　{ask.instructions}
                    </p>
                    {ask.requirements.map((piece) => {
                      const value = (ask.response!.payload as Record<string, unknown>)[piece.key]
                      return (
                        <div key={piece.key} {...stylex.props(styles.field)}>
                          <p {...stylex.props(styles.fieldLabel)}>{piece.label}</p>
                          {piece.kind === 'file' ? (
                            Array.isArray(value) && value.length > 0 ? (
                              <span {...stylex.props(styles.fileRow)}>
                                {value.map((id) => (
                                  <AttachmentLink
                                    key={String(id)}
                                    attachmentId={String(id)}
                                    variant="card"
                                    mark="supplement"
                                  />
                                ))}
                              </span>
                            ) : (
                              <p {...stylex.props(styles.fieldCleared)}>–</p>
                            )
                          ) : (
                            <p {...stylex.props(styles.fieldValue)}>
                              {typeof value === 'string' && value !== '' ? value : '–'}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </section>
                ))}
              </>
            )}
          </Swap>
        </ScrollArea>

        <div {...stylex.props(styles.actionBar)}>{footer}</div>
      </SheetContent>
    </Sheet>
  )
}

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
