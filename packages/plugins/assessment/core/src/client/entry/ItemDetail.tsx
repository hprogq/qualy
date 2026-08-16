import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { PencilIcon, PlusIcon } from 'lucide-react'
import { assessmentMessages as m } from '../i18n.ts'
import { AttachmentLink } from './AttachmentLink.tsx'
import { Basis } from './Basis.tsx'
import { entryStatusMessage, fieldsOf, trimAmount, type EntryDto, type ItemDto } from './model.ts'
import {
  chainLength,
  eachWorth,
  entryScore,
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

export function ItemDetail({
  row,
  entries,
  standing,
  busy,
  onFile,
  onHistory,
  onStatus,
  onAppeal,
}: {
  row: StructureRow
  entries: readonly EntryDto[]
  standing: Standing | null
  busy: boolean
  onFile: (entry: EntryDto | null) => void
  onHistory: (entryId: string) => void
  onStatus: (entryId: string, status: 'in_review' | 'draft') => void
  onAppeal: (entry: EntryDto) => void
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
  // both are the reader's to finish: one they have not sent yet, one that
  // came back asking for more
  const drafts = live.filter(
    (entry) => entry.status === 'draft' || entry.status === 'needs_revision',
  )
  const filed = live.filter(
    (entry) => entry.status !== 'draft' && entry.status !== 'needs_revision',
  )
  const draft = drafts[0]
  // Recording takes effect on the spot; the chain configured on the question
  // is the way back in if somebody contests it, not a queue this claim sits
  // in. Naming it here would tell the reader to wait for something that is
  // not going to happen.
  const recorded = item.currentRevision?.entrySource === 'administrative'

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
            <Badge variant="secondary" className="font-normal">
              {item.maxEntries === null
                ? format(m.itemsPreviewNoMax)
                : format(m.myEntriesRoom, { most: item.maxEntries, used: live.length })}
            </Badge>
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
        {/* A draft already holds one of the question's places, so finishing
            it is open even once there is no room for another. A question
            whose places are full keeps its button, disabled with the reason
            on hover: a control that vanishes reads as a page that lost
            something, and the reason it cannot be pressed is exactly what
            the reader wants to know. Questions that were never this
            person's to file - recorded ones, withdrawn ones - show nothing,
            because there the button never existed. */}
        {draft !== undefined && item.status === 'active' ? (
          <Button className="shrink-0" onClick={() => onFile(draft)}>
            <PencilIcon aria-hidden />
            {format(m.myEntriesResumeDraft)}
          </Button>
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

      {drafts.map((entry) => (
        <div
          key={entry.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3"
        >
          <Standing status={entry.status} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm">{summary(entry, item)}</span>
            <span className="text-xs text-muted-foreground">
              {format(m.myEntriesDraftSaved, { when: when(entry) })}
            </span>
          </span>
          <Button variant="outline" size="sm" onClick={() => onFile(entry)}>
            {format(m.myEntriesResume)}
          </Button>
          {entry.capabilities.canSubmit && (
            <Button size="sm" disabled={busy} onClick={() => onStatus(entry.id, 'in_review')}>
              {format(m.entrySubmit)}
            </Button>
          )}
        </div>
      ))}

      {/* Cards, two abreast where the pane is wide enough: four claims fit
          one screen instead of a scroll, and comparing two of them stops
          meaning holding one in your head. One column again below that -
          squeezed cards truncate the very answers they exist to show. */}
      {filed.length > 0 && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {filed.map((entry) => (
            <FiledEntry
              key={entry.id}
              entry={entry}
              item={item}
              score={entryScore(standing, entry.id)}
              busy={busy}
              onHistory={() => onHistory(entry.id)}
              onWithdraw={() => onStatus(entry.id, 'draft')}
              onAppeal={() => onAppeal(entry)}
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
  onWithdraw,
  onAppeal,
}: {
  entry: EntryDto
  item: ItemDto
  score: string | null
  busy: boolean
  onHistory: () => void
  onWithdraw: () => void
  onAppeal: () => void
}) {
  const { format } = useI18n()
  const fields = fieldsOf(item.currentRevision?.formConfig)
  const payload = (entry.currentRevision?.payload ?? {}) as Record<string, unknown>

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Standing status={entry.status} />
        <p className="text-xs whitespace-nowrap text-muted-foreground">{when(entry)}</p>
        <span className="flex-1" />
        {score !== null && <p className="text-sm tabular-nums">{score}</p>}
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
              <dt className="whitespace-nowrap text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0">
                {field.type === 'attachment' ? (
                  Array.isArray(value) && value.length > 0 ? (
                    <span className="flex min-w-0 flex-col gap-1">
                      {value.map((id) => (
                        <AttachmentLink key={String(id)} attachmentId={String(id)} compact />
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

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onHistory}>
          {format(m.entryHistoryOpen)}
        </Button>
        {entry.capabilities.canWithdraw && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onWithdraw}>
            {format(m.entryWithdraw)}
          </Button>
        )}
        {/* two different things, offered as two: change the material and
            submit again, or leave it and say the conclusion is wrong */}
        {entry.capabilities.canAppeal && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onAppeal}>
            {format(m.entryAppeal)}
          </Button>
        )}
      </div>
    </div>
  )
}

/** where a claim stands, as a dot and a word */
function Standing({ status }: { status: EntryDto['status'] }) {
  const { format } = useI18n()
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap">
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          status === 'approved'
            ? 'bg-foreground'
            : status === 'rejected'
              ? 'bg-destructive'
              : 'bg-muted-foreground/50',
        )}
      />
      {format(entryStatusMessage[status])}
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
