import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { AlertCircleIcon, PlusIcon } from 'lucide-react'
import { assessmentMessages as m } from '../i18n.ts'
import { entryRefusalReason } from './refusals.ts'
import { AttachmentLink } from './AttachmentLink.tsx'
import { Basis } from './Basis.tsx'
import {
  entryStatusMessage,
  fieldsOf,
  trimAmount,
  type ActionAvailability,
  type EntryDto,
  type ItemDto,
} from './model.ts'
import {
  chainLength,
  eachWorth,
  entryScore,
  itemScore,
  mayFile,
  roomLeft,
  type Standing,
  type StructureRow,
} from './standing.ts'

// One question, and what this person has put into it.
//
// The question's own terms come first - what a claim is worth, how many are
// allowed, how many people have to agree - because those are what decide
// whether it is worth filing another. Then the claims themselves, each shown
// as the answers that were given rather than as a row to expand.
//
// Every claim is the same card, draft or filed. A draft is not a different
// kind of thing - it is this claim, before it was handed on - so it keeps the
// frame, the field layout and the row of actions, and says what it is with a
// dashed edge, a paler ground and a hollow dot. Two shapes made the reader
// learn twice where to look for the same answer.

export function ItemDetail({
  row,
  entries,
  standing,
  busy,
  onFile,
  onDeclare,
  onHistory,
  onStatus,
  onAppeal,
  onSupplement,
}: {
  row: StructureRow
  entries: readonly EntryDto[]
  standing: Standing | null
  busy: boolean
  onFile: (entry: EntryDto | null) => void
  /** a declaration's one press: file and hand on, no dialog */
  onDeclare: () => void
  onHistory: (entryId: string) => void
  onStatus: (entryId: string, status: 'in_review' | 'draft' | 'voided') => void
  onAppeal: (entry: EntryDto) => void
  /** answering the reviewer's ask for more material */
  onSupplement: (entry: EntryDto) => void
}) {
  const { format } = useI18n()
  const item = row.item
  if (item === undefined) return null

  const description = String(
    (item.currentRevision?.displayConfig as { description?: unknown } | undefined)?.description ??
      '',
  ).trim()
  const each = eachWorth(item)
  const room = roomLeft(item, entries)
  const steps = chainLength(item)
  const live = entries.filter((entry) => entry.status !== 'voided')
  // counted separately only to say how many of each there are; they are all
  // drawn as the same card, in the order they were filed
  const drafts = live.filter(
    (entry) => entry.status === 'draft' || entry.status === 'needs_revision',
  )
  const filed = live.filter(
    (entry) => entry.status !== 'draft' && entry.status !== 'needs_revision',
  )
  const draft = drafts[0]
  const counted = itemScore(standing, item.id)
  // Recording takes effect on the spot; the chain configured on the question
  // is the way back in if somebody contests it, not a queue this claim sits
  // in. Naming it here would tell the reader to wait for something that is
  // not going to happen.
  const recorded = item.currentRevision?.entrySource === 'administrative'
  // granted to everybody on the roster: nothing to file, nothing to wait for
  const granted = item.itemType === 'constant'
  // declared, not composed: the press is the filing, so no dialog ever opens
  const declared = item.itemType === 'declaration'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          {row.trail.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">{row.trail.join(' › ')}</p>
          )}
          <h2 className="min-w-0 text-xl font-semibold tracking-tight">{item.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {each !== undefined && (
              <Badge variant="secondary" className="font-normal">
                {format(m.entryCountsFor, { value: trimAmount(each) })}
              </Badge>
            )}
            {granted ? (
              <Badge variant="outline" className="font-normal">
                {format(m.myEntriesGranted)}
              </Badge>
            ) : (
              <Badge variant="secondary" className="font-normal">
                {item.maxEntries === null
                  ? format(m.itemsPreviewNoMax)
                  : format(m.myEntriesRoom, { most: item.maxEntries, used: live.length })}
              </Badge>
            )}
            {steps > 0 && !recorded && (
              <Badge variant="secondary" className="font-normal">
                {format(m.myEntriesChain, { count: steps })}
              </Badge>
            )}
            {recorded && (
              <Badge variant="outline" className="font-normal">
                {format(m.myEntriesRecorded)}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {/* what this question has actually granted, beside the way to add
              to it: the claims below each carry their own number, and this is
              the one they add up to */}
          {counted !== null && (
            <span className="flex flex-col gap-0.5 text-right">
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {format(m.itemCounted)}
              </span>
              <span className="text-lg leading-none font-semibold tabular-nums">
                {trimAmount(counted)}
              </span>
            </span>
          )}
          {/* One way in, whatever is already filed: an unfinished draft is
              picked up from its own card below, which is where it is being
              read. A question whose places are full keeps the button,
              disabled with the reason on hover - a control that vanishes
              reads as a page that lost something. Questions that were never
              this person's to file show nothing. */}
          {granted ? null : declared ? (
            mayFile(item, entries) && draft === undefined ? (
              <Button className="shrink-0" disabled={busy} onClick={onDeclare}>
                <PlusIcon aria-hidden />
                {format(m.entryDeclare)}
              </Button>
            ) : null
          ) : mayFile(item, entries) ? (
            <Button className="shrink-0" onClick={() => onFile(null)}>
              <PlusIcon aria-hidden />
              {format(m.entryNew)}
            </Button>
          ) : (
            item.status === 'active' &&
            item.currentRevision?.entrySource === 'student' &&
            (roomLeft(item, entries) ?? 1) <= 0 && (
              <TooltipProvider>
                <Tooltip>
                  {/* a disabled button swallows pointer events, so the span
                      around it is what the tooltip listens to */}
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="shrink-0">
                      <Button disabled className="pointer-events-none">
                        <PlusIcon aria-hidden />
                        {format(m.entryNew)}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{format(m.refuseMaxEntries)}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          )}
        </div>
      </div>

      {description !== '' && <p className="text-sm leading-relaxed text-pretty">{description}</p>}

      <Basis />

      {item.status === 'voided' && (
        <p className="rounded-lg bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
          {format(m.itemVoided)}
        </p>
      )}

      <div className="flex items-baseline justify-between gap-3 border-b pb-2">
        <h3 className="text-sm font-semibold">
          {format(recorded ? m.myEntriesRecordedFiled : m.myEntriesFiled)}
        </h3>
        <p className="text-xs text-muted-foreground">
          {recorded
            ? format(m.myEntriesRows, { count: filed.length })
            : format(m.myEntriesFiledCount, {
                filed: filed.length,
                drafts: drafts.length,
                room: room ?? -1,
              })}
        </p>
      </div>

      {live.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {format(recorded ? m.myEntriesRecordedNone : m.myEntriesNoneYet)}
        </p>
      )}

      {/* Cards, two abreast where the pane is wide enough: four claims fit
          one screen instead of a scroll, and comparing two of them stops
          meaning holding one in your head. One column again below that -
          squeezed cards truncate the very answers they exist to show. */}
      {live.length > 0 && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {live.map((entry) => (
            <FiledEntry
              key={entry.id}
              entry={entry}
              item={item}
              score={entryScore(standing, entry.id) ?? (each === undefined ? null : each)}
              busy={busy}
              onHistory={() => onHistory(entry.id)}
              onEdit={() => onFile(entry)}
              onStatus={(status) => onStatus(entry.id, status)}
              onAppeal={() => onAppeal(entry)}
              onSupplement={() => onSupplement(entry)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** one claim, shown as the answers that were given */
function FiledEntry({
  entry,
  item,
  score,
  busy,
  onHistory,
  onEdit,
  onStatus,
  onAppeal,
  onSupplement,
}: {
  entry: EntryDto
  item: ItemDto
  score: string | null
  busy: boolean
  onHistory: () => void
  onEdit: () => void
  onStatus: (status: 'in_review' | 'draft' | 'voided') => void
  onAppeal: () => void
  onSupplement: () => void
}) {
  const { format } = useI18n()
  const declared = item.itemType === 'declaration'
  const fields = fieldsOf(item.currentRevision?.formConfig)
  const payload = (entry.currentRevision?.payload ?? {}) as Record<string, unknown>
  const tone = toneOf(entry)
  const revisionNo = entry.currentRevision?.revisionNo

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border p-4',
        tone === 'draft' ? 'border-dashed bg-muted/30' : 'bg-card',
        tone === 'attention' && 'border-destructive/35',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Standing
          status={entry.status}
          revised={entry.currentReviewInstanceId !== null}
          asked={entry.supplement !== null}
        />
        {revisionNo !== undefined && entry.status !== 'draft' && (
          <p className="text-xs whitespace-nowrap text-muted-foreground">
            {format(m.entryVersionNo, { no: revisionNo })}
          </p>
        )}
        <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {when(entry)}
        </p>
        <span className="flex-1" />
        {/* A number on its own cannot say whether it is money in the bank or
            an estimate. The word above it does, and only the granted one is
            drawn in full ink. */}
        {score !== null && (
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-xs text-muted-foreground">
              {format(
                tone === 'ok'
                  ? m.entryScoreCounted
                  : tone === 'wait'
                    ? m.entryScorePending
                    : m.entryScoreIfApproved,
              )}
            </span>
            <span
              className={cn(
                'text-base tabular-nums',
                tone === 'ok' ? 'font-semibold' : 'font-medium text-muted-foreground',
              )}
            >
              {trimAmount(score)}
            </span>
          </span>
        )}
      </div>

      {/* The label column is fixed rather than sized to the longest label:
          two cards side by side then read as one table, and the answers line
          up across the pane instead of stepping in and out with whatever
          each claim happened to be asked. Written answers stay on one line -
          a card is for telling claims apart, and the whole text is one press
          away in the history. */}
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {fields.map((field) => {
          const value = payload[field.key]
          return (
            <div key={field.key} className="col-span-2 grid grid-cols-subgrid">
              <dt className="min-w-0 [overflow-wrap:anywhere] text-muted-foreground">
                {field.label}
              </dt>
              <dd className="min-w-0">
                {field.type === 'attachment' ? (
                  Array.isArray(value) && value.length > 0 ? (
                    <span className="flex min-w-0 flex-col gap-1">
                      {value.map((id) => (
                        <AttachmentLink key={String(id)} attachmentId={String(id)} variant="line" />
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{format(m.entryFieldCleared)}</span>
                  )
                ) : (
                  <span
                    className={cn('block truncate', field.type === 'date' && 'tabular-nums')}
                    title={typeof value === 'string' && value !== '' ? value : undefined}
                  >
                    {typeof value === 'string' && value !== ''
                      ? value
                      : format(m.entryFieldCleared)}
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      {/* The reviewer's ask, on the claim it is about: what they wrote in
          full - it is an instruction, not a heading - then the pieces they
          named, then the one press that answers it. */}
      {entry.supplement !== null && (
        <div className="flex flex-col gap-2.5 rounded-lg bg-muted p-3">
          <div className="flex items-center gap-2">
            <AlertCircleIcon aria-hidden className="size-4 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 text-sm font-medium">{format(m.entrySupplementTitle)}</p>
          </div>
          <p className="border-l-2 border-destructive/30 pl-2.5 text-sm leading-relaxed text-pretty">
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
                    {format(asked.kind === 'file' ? m.supplementAddFile : m.supplementAddText)}
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
          <Button size="sm" className="self-stretch" disabled={busy} onClick={onSupplement}>
            {format(m.entrySupplementAnswer)}
          </Button>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {/* a draft nobody has ever seen has no story to open yet */}
        {(entry.status !== 'draft' || entry.currentReviewInstanceId !== null) && (
          <Button variant="outline" size="sm" onClick={onHistory}>
            {format(m.entryHistoryOpen)}
          </Button>
        )}
        {!declared && (
          <Offered
            can={entry.capabilities.edit}
            busy={busy}
            label={format(entry.status === 'draft' ? m.myEntriesResume : m.entryEdit)}
            onPress={onEdit}
          />
        )}
        {/* a rejected filing may go back as it stands; the round said no to
            the filing and the answer may be "look again" */}
        <Offered
          can={entry.capabilities.submit}
          busy={busy}
          label={format(entry.status === 'draft' ? m.entrySubmit : m.entryResubmit)}
          onPress={() => onStatus('in_review')}
        />
        <Offered
          can={entry.capabilities.withdraw}
          busy={busy}
          label={format(m.entryWithdraw)}
          onPress={() => onStatus('draft')}
        />
        {/* two different things, offered as two: change the material and
            submit again, or leave it and say the conclusion is wrong */}
        <Offered
          can={entry.capabilities.appeal}
          busy={busy}
          label={format(m.entryAppeal)}
          onPress={onAppeal}
        />
        <Offered
          can={entry.capabilities.abandon}
          busy={busy}
          tone="quiet"
          label={format(m.entryAbandon)}
          onPress={() => {
            if (window.confirm(format(m.entryAbandonConfirm))) onStatus('voided')
          }}
        />
      </div>

      {/* the one sentence the card can say truthfully without the whole
          story: where this claim is waiting, and on whom */}
      {entry.supplement !== null ? (
        <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
          {format(m.entrySupplementAsked, {
            at: new Date(entry.supplement.requestedAt).toLocaleString(),
            who: entry.supplement.requestedByName ?? format(m.eventSomebody),
          })}
        </p>
      ) : (
        entry.status === 'draft' && (
          <p className="text-xs text-muted-foreground">
            {format(m.entryDraftSavedFoot, { at: when(entry) })}
          </p>
        )
      )}
    </div>
  )
}

/**
 * What a claim's card looks like it is: granted, waiting on somebody else,
 * waiting on the reader, or not handed on yet.
 *
 * One value rather than a switch per detail, so the edge, the dot and the
 * word above the number cannot drift apart.
 */
type CardTone = 'ok' | 'wait' | 'draft' | 'attention'

const toneOf = (entry: EntryDto): CardTone =>
  entry.status === 'approved'
    ? 'ok'
    : entry.supplement !== null || entry.status === 'rejected' || entry.status === 'needs_revision'
      ? 'attention'
      : entry.status === 'in_review'
        ? 'wait'
        : 'draft'

/**
 * One act on one claim, in whatever state the server offered it: a button,
 * a disabled button with the reason on hover, or nothing. The reason is the
 * refusal vocabulary the error catalog already speaks.
 */
function Offered({
  can,
  busy,
  label,
  size = 'sm',
  tone,
  onPress,
}: {
  can: ActionAvailability
  busy: boolean
  label: string
  size?: 'sm' | 'default'
  tone?: 'quiet'
  onPress: () => void
}) {
  const { format } = useI18n()
  if (can.state === 'hidden') return null
  const button = (
    <Button
      variant="outline"
      size={size}
      disabled={busy || can.state === 'blocked'}
      className={cn(
        can.state === 'blocked' && 'pointer-events-none',
        tone === 'quiet' && 'text-muted-foreground',
      )}
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

/**
 * Where a claim stands, as a dot and a word.
 *
 * The dot carries the weight: filled and dark for what counts, hollow for a
 * draft nobody has been handed yet, red for whatever is waiting on the
 * reader. The pill's own edge follows, so a card can be read across the pane
 * without reading the word.
 */
function Standing({
  status,
  revised,
  asked,
}: {
  status: EntryDto['status']
  revised?: boolean
  /** a reviewer is waiting for material, which outranks "in review" */
  asked?: boolean
}) {
  const { format } = useI18n()
  const word =
    asked === true
      ? m.entryStatusAwaitingSupplement
      : status === 'draft' && revised === true
        ? // a draft with a round behind it is not a fresh draft: it exists
          // because something was asked of it
          m.entryStatusRevising
        : entryStatusMessage[status]
  const alert = asked === true || status === 'rejected' || status === 'needs_revision'
  const hollow = status === 'draft' && asked !== true
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap',
        alert && 'border-destructive/35 text-destructive',
        hollow && 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          hollow
            ? 'border border-muted-foreground/50'
            : alert
              ? 'bg-destructive'
              : status === 'approved'
                ? 'bg-foreground'
                : 'bg-muted-foreground/60',
        )}
      />
      {format(word)}
    </span>
  )
}

/** the first answer this claim gave, which is how its owner recognises it */
const summary = (entry: EntryDto, item: ItemDto): string => {
  const fields = fieldsOf(item.currentRevision?.formConfig)
  const payload = (entry.currentRevision?.payload ?? {}) as Record<string, unknown>
  const said = fields
    .map((field) => payload[field.key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
  return said.length === 0 ? item.title : said.join('　')
}

const when = (entry: EntryDto): string =>
  new Date(entry.currentRevision?.createdAt ?? entry.createdAt).toLocaleString()
