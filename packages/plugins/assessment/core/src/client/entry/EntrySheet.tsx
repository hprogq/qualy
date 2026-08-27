import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { AlertCircleIcon, XIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { ConfirmDialog } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Breadcrumb } from '@qualy/ui/breadcrumb'
import { Button } from '@qualy/ui/button'
import { Swap } from '@qualy/ui/reveal'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Count } from '@qualy/ui/count'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { entryRefusalReason } from './refusals.ts'
import { AttachmentLink } from './AttachmentLink.tsx'
import { EntryTrail } from './EntryHistory.tsx'
import { EntryStanding } from './EntryStanding.tsx'
import { fieldsOf, type ActionAvailability, type EntryDto, type ItemDto } from './model.ts'

// One claim, in full, in a drawer over the list it came from.
//
// Not a dialog and not a page of its own: a dialog would cover the sibling
// claims it is being read against, and a page costs a journey there and back
// for what is one claim on the same question. The drawer keeps the list
// behind it and closes in place. Everything the card does not say lives
// here - every field, the refusal in full, the reviewer's asks with what
// answered them, the whole account - and so do the acts, because acting on
// a claim is done while reading it, not from a row of buttons on a card
// that had no room to say why.

const styles = stylex.create({
  panel: {
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
    gap: 0,
    padding: 0,
    maxWidth: { default: null, '@media (min-width: 640px)': '48rem' },
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
      {rows.map((field) => (
        <p key={field.key} {...stylex.props(styles.suggestedLine)}>
          <span {...stylex.props(styles.suggestedLabel)}>{field.label}</span>
          <span {...stylex.props(styles.anywhere)}>
            {String(record[field.key] ?? '') === '' ? '—' : String(record[field.key] ?? '')}
          </span>
        </p>
      ))}
    </div>
  )
}

export function EntrySheet({
  open,
  entry,
  item,
  resubmit,
  trail,
  busy,
  onClose,
  onEdit,
  onStatus,
  onAppeal,
  onSupplement,
}: {
  open: boolean
  entry: EntryDto
  item: ItemDto
  /**
   * The phase gate's word on submitting into this question at all,
   * independent of the claim's state. Withdrawing while it is shut is a
   * one-way door - the draft cannot be handed back in this phase - and the
   * confirm changes register accordingly.
   */
  resubmit: ActionAvailability | undefined
  /** the groups above the question, outermost first */
  trail: readonly string[]
  busy: boolean
  onClose: () => void
  onEdit: () => void
  /** the second argument is the question this drawer was showing, for submission */
  onStatus: (status: 'in_review' | 'draft' | 'voided', expectedItemRevisionId?: string) => void
  onAppeal: () => void
  onSupplement: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  // which act is waiting on an answer; every one of them moves the claim
  const [asking, setAsking] = useState<'in_review' | 'draft' | 'voided' | null>(null)
  const [tab, setTab] = useState<'content' | 'trail'>('content')
  // withdrawing with submission shut is a one-way door; an absent word from
  // the server is not a shut one, so only an explicit refusal changes tone
  const oneWay = resubmit !== undefined && resubmit.state !== 'available'
  const fields = fieldsOf(item.currentRevision?.formConfig)
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
                      <p {...stylex.props(styles.prose)}>{entry.refusal.comment}</p>
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
                    <Button size="sm" disabled={busy} onClick={onSupplement}>
                      {format(m.entrySupplementAnswer)}
                    </Button>
                  </div>
                )}

                <section {...stylex.props(styles.section)}>
                  <div {...stylex.props(styles.sectionHead)}>
                    <p {...stylex.props(styles.sectionTitle)}>{format(m.entrySheetOwn)}</p>
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
                            {typeof value === 'string' && value !== ''
                              ? value
                              : format(m.entryFieldCleared)}
                          </p>
                        )}
                      </div>
                    )
                  })}
                  {(entry.currentRevision?.note ?? null) !== null && (
                    <div {...stylex.props(styles.field)}>
                      <p {...stylex.props(styles.fieldLabel)}>{format(m.entryNote)}</p>
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
                              <p {...stylex.props(styles.fieldCleared)}>—</p>
                            )
                          ) : (
                            <p {...stylex.props(styles.fieldValue)}>
                              {typeof value === 'string' && value !== '' ? value : '—'}
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

        <div {...stylex.props(styles.actionBar)}>
          <Offered
            can={entry.capabilities.abandon}
            busy={busy}
            variant="ghost"
            xstyle={styles.ghostInk}
            label={format(m.entryAbandon)}
            onPress={() => setAsking('voided')}
          />
          <span {...stylex.props(styles.spacer)} />
          <Offered
            can={entry.capabilities.appeal}
            busy={busy}
            label={format(m.entryAppeal)}
            onPress={onAppeal}
          />
          <Offered
            can={entry.capabilities.withdraw}
            busy={busy}
            label={format(m.entryWithdraw)}
            onPress={() => setAsking('draft')}
          />
          {!declared && (
            <Offered
              can={entry.capabilities.edit}
              busy={busy}
              label={format(entry.status === 'draft' ? m.myEntriesResume : m.entryEdit)}
              onPress={onEdit}
            />
          )}
          <Offered
            can={entry.capabilities.submit}
            busy={busy}
            variant="default"
            label={format(entry.status === 'draft' ? m.entrySubmit : m.entryResubmit)}
            onPress={() => setAsking('in_review')}
          />
        </div>

        {/* Every act here changes who holds the claim, so every one of them
            is a question first: handing it on, taking it back, and giving it
            up. The words differ because the consequences do, and giving up
            is the only one that cannot be undone. Taking it back while the
            phase has shut submission joins the irreversible ones: the draft
            it leaves behind cannot be handed in again until submitting
            reopens, and the confirm must say so before, not after. */}
        <ConfirmDialog
          open={asking !== null}
          tone={asking === 'voided' || (asking === 'draft' && oneWay) ? 'destructive' : 'default'}
          title={format(
            asking === 'voided'
              ? m.entryAbandonConfirmTitle
              : asking === 'draft'
                ? m.entryWithdrawConfirm
                : m.entrySubmitConfirm,
          )}
          description={format(
            asking === 'voided'
              ? m.entryAbandonConfirm
              : asking === 'draft'
                ? oneWay
                  ? m.entryWithdrawFinalHint
                  : m.entryWithdrawConfirmHint
                : m.entrySubmitConfirmHint,
          )}
          confirmLabel={format(
            asking === 'voided'
              ? m.entryAbandon
              : asking === 'draft'
                ? m.entryWithdraw
                : entry.status === 'draft'
                  ? m.entrySubmit
                  : m.entryResubmit,
          )}
          cancelLabel={format(commonMessages.cancel)}
          pending={busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const act = asking
            setAsking(null)
            // Only handing it on is a decision about today's rules; taking
            // it back or giving it up are about the claim alone, and a
            // question that moved in the meantime does not change them.
            if (act === 'in_review') onStatus(act, item.currentRevision?.id)
            else if (act !== null) onStatus(act)
          }}
        />
      </SheetContent>
    </Sheet>
  )
}

/**
 * One act on one claim, in whatever state the server offered it: a button,
 * a disabled button with the reason on hover, or nothing. The reason is the
 * refusal vocabulary the error catalog already speaks.
 */
function Offered({
  can,
  busy,
  label,
  variant = 'outline',
  xstyle,
  onPress,
}: {
  can: ActionAvailability
  busy: boolean
  label: string
  variant?: 'outline' | 'default' | 'ghost'
  xstyle?: stylex.StyleXStyles
  onPress: () => void
}) {
  const { format } = useI18n()
  if (can.state === 'hidden') return null
  const button = (
    <Button
      variant={variant}
      size="sm"
      disabled={busy || can.state === 'blocked'}
      className={stylex.props(can.state === 'blocked' && styles.noPointer, xstyle).className}
      onClick={onPress}
    >
      {label}
    </Button>
  )
  if (can.state === 'available') return button
  const why = can.reason === null ? null : entryRefusalReason(can.reason)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{button}</span>
        </TooltipTrigger>
        <TooltipContent>{format(why ?? m.entryBlockedNow)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
