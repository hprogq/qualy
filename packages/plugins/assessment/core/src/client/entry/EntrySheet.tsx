import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircleIcon, XIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Badge } from '@qualy/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@qualy/ui/breadcrumb'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Swap } from '@qualy/ui/reveal'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
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

type History = ApiResult<typeof assessmentApi, 'assessment', 'getEntryHistory'>

export function EntrySheet({
  open,
  entry,
  item,
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
  /** the groups above the question, outermost first */
  trail: readonly string[]
  busy: boolean
  onClose: () => void
  onEdit: () => void
  onStatus: (status: 'in_review' | 'draft' | 'voided') => void
  onAppeal: () => void
  onSupplement: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const [tab, setTab] = useState<'content' | 'trail'>('content')
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
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-3xl"
        showCloseButton={false}
      >
        <div className="flex shrink-0 items-start gap-3 border-b px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap text-xs sm:gap-1.5">
                {trail.map((name, index) => (
                  <BreadcrumbItem key={index} className="min-w-0">
                    {index > 0 && <BreadcrumbSeparator />}
                    <span className="min-w-0 truncate">{name}</span>
                  </BreadcrumbItem>
                ))}
                <BreadcrumbItem className="min-w-0">
                  {trail.length > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbPage className="min-w-0 truncate">{item.title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="shrink-0 text-base font-semibold">
                {format(m.entrySheetTitle)}
              </SheetTitle>
              <EntryStanding
                status={entry.status}
                revised={entry.currentReviewInstanceId !== null}
                asked={entry.supplement !== null}
              />
              {revisionNo !== undefined && entry.status !== 'draft' && (
                <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                  {format(m.entryVersionNo, { no: revisionNo })}
                </span>
              )}
            </div>
          </div>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={format(commonMessages.close)}
            onClick={onClose}
          >
            <XIcon aria-hidden />
          </Button>
        </div>

        <div className="flex shrink-0 gap-0.5 border-b px-5">
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
              className={cn(
                'relative inline-flex h-9 items-center gap-1.5 px-2.5 text-sm whitespace-nowrap',
                tab === key ? 'font-medium' : 'text-muted-foreground',
              )}
            >
              {format(label)}
              <span className="rounded bg-muted px-1 text-xs tabular-nums">{count}</span>
              {tab === key && (
                <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-foreground" />
              )}
            </button>
          ))}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {/* the two tabs replace each other in place, seen to change */}
          <Swap swapKey={tab} className="flex flex-col gap-5 px-5 py-4">
            {tab === 'trail' ? (
              <EntryTrail entryId={entry.id} />
            ) : (
              <>
                {/* why it came back, first: it is the reason this drawer was
                    opened at all when the claim is waiting on its owner */}
                {entry.refusal !== null && (
                  <div className="flex flex-col gap-1.5 rounded-xl bg-muted p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <p className="shrink-0 text-sm font-semibold text-destructive">
                        {format(
                          entry.refusal.kind === 'rejected'
                            ? m.entryRefusedTitle
                            : m.entryReturnedTitle,
                        )}
                      </p>
                      {entry.refusal.reason !== null && (
                        <Badge variant="outline" className="bg-background font-normal">
                          {entry.refusal.reason}
                        </Badge>
                      )}
                      <span className="flex-1" />
                      <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {new Date(entry.refusal.at).toLocaleString()}
                      </span>
                    </div>
                    {(entry.refusal.comment ?? '') !== '' && (
                      <p className="text-sm leading-relaxed text-pretty">{entry.refusal.comment}</p>
                    )}
                  </div>
                )}

                {/* the open ask, with its answer one press away */}
                {entry.supplement !== null && (
                  <div className="flex flex-col gap-2.5 rounded-xl bg-muted p-3">
                    <div className="flex items-center gap-2">
                      <AlertCircleIcon aria-hidden className="size-4 shrink-0 text-destructive" />
                      <p className="min-w-0 flex-1 text-sm font-medium">
                        {format(m.entrySupplementTitle)}
                      </p>
                    </div>
                    <p className="text-sm leading-relaxed text-pretty">
                      {entry.supplement.instructions}
                    </p>
                    {entry.supplement.requirements.length > 0 && (
                      <div className="flex flex-col gap-1.5 border-t pt-2.5">
                        <p className="text-xs text-muted-foreground">{format(m.supplementNeeds)}</p>
                        {entry.supplement.requirements.map((asked) => (
                          <span key={asked.key} className="flex items-center gap-2 text-sm">
                            <span
                              aria-hidden
                              className="size-1 shrink-0 rounded-full bg-muted-foreground/50"
                            />
                            <span className="min-w-0 truncate">{asked.label}</span>
                            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                              {format(
                                asked.kind === 'file' ? m.supplementAddFile : m.supplementAddText,
                              )}
                            </span>
                            {asked.required && (
                              <span className="shrink-0 text-xs whitespace-nowrap text-destructive">
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

                {/* what was filed, whole: the card's three lines are a
                    reminder, this is the filing */}
                <section className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2.5">
                    <p className="shrink-0 text-sm font-semibold text-muted-foreground">
                      {format(m.entrySheetOwn)}
                    </p>
                    <span aria-hidden className="h-px min-w-0 flex-1 bg-border" />
                    {revisionNo !== undefined && (
                      <p className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                        {format(m.entryVersionNo, { no: revisionNo })}
                      </p>
                    )}
                  </div>
                  {fields.map((field) => {
                    const value = payload[field.key]
                    return (
                      <div key={field.key} className="flex flex-col gap-1">
                        <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                          {field.label}
                        </p>
                        {field.type === 'attachment' ? (
                          Array.isArray(value) && value.length > 0 ? (
                            <span className="flex flex-wrap gap-2">
                              {value.map((id) => (
                                <AttachmentLink
                                  key={String(id)}
                                  attachmentId={String(id)}
                                  variant="card"
                                />
                              ))}
                            </span>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {format(m.entryFieldCleared)}
                            </p>
                          )
                        ) : (
                          <p className="text-base leading-relaxed [overflow-wrap:anywhere]">
                            {typeof value === 'string' && value !== ''
                              ? value
                              : format(m.entryFieldCleared)}
                          </p>
                        )}
                      </div>
                    )
                  })}
                  {(entry.currentRevision?.note ?? null) !== null && (
                    <div className="flex flex-col gap-1">
                      <p className="text-sm text-muted-foreground">{format(m.entryNote)}</p>
                      <p className="text-base leading-relaxed [overflow-wrap:anywhere]">
                        {entry.currentRevision!.note}
                      </p>
                    </div>
                  )}
                </section>

                {/* what a reviewer asked for and what answered it, one
                    section per ask: the requirement and the material stay
                    together, because apart neither says what it is for */}
                {answered.map((ask) => (
                  <section key={ask.id} className="flex flex-col gap-3">
                    <div className="flex items-baseline gap-2.5">
                      <p className="shrink-0 text-sm font-semibold text-muted-foreground">
                        {format(m.entrySheetSupHead)}
                      </p>
                      <span aria-hidden className="h-px min-w-0 flex-1 bg-border" />
                      <p className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                        {format(m.entrySheetSupNote, {
                          round: ask.roundNo,
                          asked: timeOf(ask.requestedAt),
                          answered: timeOf(ask.response!.respondedAt),
                        })}
                      </p>
                    </div>
                    <p className="rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                      {format(m.entrySheetSupAsk)}　{ask.instructions}
                    </p>
                    {ask.requirements.map((piece) => {
                      const value = (ask.response!.payload as Record<string, unknown>)[piece.key]
                      return (
                        <div key={piece.key} className="flex flex-col gap-1">
                          <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                            {piece.label}
                          </p>
                          {piece.kind === 'file' ? (
                            Array.isArray(value) && value.length > 0 ? (
                              <span className="flex flex-wrap gap-2">
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
                              <p className="text-sm text-muted-foreground">—</p>
                            )
                          ) : (
                            <p className="text-base leading-relaxed [overflow-wrap:anywhere]">
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

        {/* The acts, once, where the whole claim is on screen: quitting on
            the far left where it cannot be pressed for one of the others,
            and handing on - the act that moves things - carrying the ink. */}
        <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
          <Offered
            can={entry.capabilities.abandon}
            busy={busy}
            variant="ghost"
            className="text-muted-foreground"
            label={format(m.entryAbandon)}
            onPress={() => {
              if (window.confirm(format(m.entryAbandonConfirm))) onStatus('voided')
            }}
          />
          <span className="flex-1" />
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
            onPress={() => onStatus('draft')}
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
            onPress={() => onStatus('in_review')}
          />
        </div>
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
  className,
  onPress,
}: {
  can: ActionAvailability
  busy: boolean
  label: string
  variant?: 'outline' | 'default' | 'ghost'
  className?: string
  onPress: () => void
}) {
  const { format } = useI18n()
  if (can.state === 'hidden') return null
  const button = (
    <Button
      variant={variant}
      size="sm"
      disabled={busy || can.state === 'blocked'}
      className={cn(can.state === 'blocked' && 'pointer-events-none', className)}
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
