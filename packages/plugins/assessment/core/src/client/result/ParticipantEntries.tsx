import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { EntryStanding } from '../entry/EntryStanding.tsx'
import { ManagedEntrySheet } from '../entry/ManagedEntrySheet.tsx'
import { sourceLabelOf } from '../entry/source.ts'
import { useLingering } from '@qualy/ui/use-lingering'
import type { EntryDto, ItemDto } from '../entry/model.ts'

// What this person filed, and what the round decided about each of it.
//
// A ruled list rather than a wall of cards: the reader is checking an
// account, which means reading down a column of standings, and a card per
// claim turns that into scrolling. Grouped by question the way the paper is
// grouped, because a claim without the question it answers is a sentence
// without its subject.
//
// Opening one is a drawer over this list, not a page: the sibling claims are
// the context it is being read against, and a page would take them away.

// One sheet, the way the rest of the product draws a list now: white is what
// says "this is the record", the score groups are 0.985 folds in that sheet
// rather than headings floating above it, and the claims rule against each
// other instead of each carrying a box. A column of amounts is worth
// aligning, so it gets a column.
const styles = stylex.create({
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  group: { display: 'flex', minWidth: 0, flexDirection: 'column' },
  // the fold: which part of the paper the claims under it answer
  strip: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 16,
    paddingBlock: 9,
  },
  stripWord: { fontSize: 12, fontWeight: 500, color: tokens.mutedForeground },
  stripCount: {
    marginLeft: 'auto',
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 80%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  rows: { display: 'flex', minWidth: 0, flexDirection: 'column' },
  row: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: 'minmax(0, 1fr) 4.5rem 1rem',
    alignItems: 'center',
    columnGap: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    paddingInline: 16,
    paddingBlock: 12,
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'background-color',
  },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
  title: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  under: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
  rowOpen: {
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted },
  },
  // its own column, so the numbers line up against each other rather than
  // against whatever length the titles happen to be
  amount: {
    textAlign: 'right',
    fontSize: 14,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  source: { color: tokens.mutedForeground },
  chevron: {
    width: 16,
    height: 16,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  empty: {
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    paddingBlock: 48,
    textAlign: 'center',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  waiting: { height: 260, width: '100%' },
  // the way on, as the card's last row rather than a control adrift under it
  moreRow: {
    display: 'flex',
    height: 44,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
})

export function ParticipantEntries({
  batchId,
  participantId,
  entryId,
  onEntry,
}: {
  batchId: string
  participantId: string
  entryId: string
  onEntry: (entryId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()

  const entries = useQuery(
    query.assessment.listParticipantEntries.queryOptions({
      params: { batchId, participantId },
      query: {},
    }),
  )
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  // read, not fetched twice: the detail above has it open already, so this
  // is the cache it filled
  const result = useQuery(
    query.assessment.getParticipantResult.queryOptions({ params: { batchId, participantId } }),
  )
  const groups = useQuery(query.assessment.listScoreGroups.queryOptions({ params: { batchId } }))

  const rows = entries.data?.entries ?? []
  // the amount each claim contributed, taken from the ledger rather than
  // computed here: an amount worked out twice is an amount that can disagree
  const countedBy = new Map(
    (result.data?.lines ?? []).flatMap((line) =>
      line.provenance?.entryId === undefined || line.kind !== 'entry'
        ? []
        : [[line.provenance.entryId, line.value] as const],
    ),
  )
  const itemsById = new Map((items.data?.items ?? []).map((item) => [item.id, item as ItemDto]))
  const groupsById = new Map((groups.data?.groups ?? []).map((group) => [group.id, group]))

  // Both corrections are the same api act with a different word, and both
  // change what the score is made of - so the account, the claims and the
  // claim itself are all asked again rather than patched in place.
  const intervene = useMutation({
    mutationFn: (input: {
      entryId: string
      kind: 'return-for-revision' | 'void'
      reason: string
    }) =>
      run(
        api.assessment.interveneOnEntry({
          params: { entryId: input.entryId },
          payload: { kind: input.kind, reason: input.reason },
        }),
      ).then(() => input.kind),
    onSuccess: (kind) => {
      toast.success(format(kind === 'void' ? m.staffVoided : m.staffReturned))
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listParticipantEntries.key({
          params: { batchId, participantId },
          query: {},
        }),
      })
      void queryClient.invalidateQueries({
        queryKey: query.assessment.getParticipantResult.key({
          params: { batchId, participantId },
        }),
      })
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const open = rows.find((one) => one.entry.id === entryId) ?? null
  // kept mounted while the drawer shuts, or it would vanish rather than close
  const lingering = useLingering(open)

  // Grouped the way the paper is grouped, by score group: a claim without
  // the part of the round it belongs to is a sentence without its subject.
  // Grouping by question instead printed the question's title twice - once
  // as the heading and again on the row under it.
  const groupOf = (row: (typeof rows)[number]) =>
    itemsById.get(row.entry.itemId)?.scoreGroupId ?? ''
  type Claim = (typeof rows)[number]
  const byGroup = new Map<string, Claim[]>()
  for (const row of rows) {
    const key = groupOf(row)
    const bucket = byGroup.get(key)
    if (bucket === undefined) byGroup.set(key, [row])
    else bucket.push(row)
  }
  for (const bucket of byGroup.values()) {
    bucket.sort(
      (a, b) =>
        (itemsById.get(a.entry.itemId)?.sortOrder ?? 0) -
        (itemsById.get(b.entry.itemId)?.sortOrder ?? 0),
    )
  }
  const buckets = [...byGroup.entries()].sort(
    ([left], [right]) =>
      (groupsById.get(left)?.sortOrder ?? 0) - (groupsById.get(right)?.sortOrder ?? 0),
  )

  return (
    <>
      <AsyncSection
        pending={entries.isPending || items.isPending}
        error={entries.isError ? formatError(entries.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => {
          void entries.refetch()
          void items.refetch()
        }}
        skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
      >
        {rows.length === 0 ? (
          <p {...stylex.props(styles.empty)}>{format(m.participantResultsEntriesEmpty)}</p>
        ) : (
          <div {...stylex.props(styles.card)}>
            {buckets.map(([groupId, claims]) => {
              const group = groupsById.get(groupId)
              return (
                <section key={groupId || 'ungrouped'} {...stylex.props(styles.group)}>
                  <div {...stylex.props(styles.strip)}>
                    <h3 {...stylex.props(styles.stripWord)}>
                      {group?.name ?? format(m.participantResultsUngrouped)}
                    </h3>
                    <span {...stylex.props(styles.stripCount)}>
                      {format(m.participantResultsClaimCount, { count: claims.length })}
                    </span>
                  </div>
                  <div {...stylex.props(styles.rows)}>
                    {claims.map(({ entry }) => {
                      const item = itemsById.get(entry.itemId)
                      const counted = countedBy.get(entry.id)
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          data-testid="participant-entry"
                          data-entry={entry.id}
                          {...stylex.props(styles.row, entry.id === entryId && styles.rowOpen)}
                          onClick={() => onEntry(entry.id)}
                        >
                          <span {...stylex.props(styles.words)}>
                            <span {...stylex.props(styles.title)}>
                              {item?.title ?? format(m.itemsUntitled)}
                            </span>
                            <span {...stylex.props(styles.under)}>
                              <span {...stylex.props(styles.source)}>
                                {format(sourceLabelOf(entry.source))}
                              </span>
                              <EntryStanding
                                status={entry.status}
                                revised={entry.currentReviewInstanceId !== null}
                                asked={entry.supplement !== null}
                              />
                            </span>
                          </span>
                          {/* what it came to, when the ledger says it came to
                              anything: the two halves of this account answer
                              each other rather than sitting side by side. The
                              seat is kept either way, so the chevrons stay in
                              one line down the card. */}
                          <span {...stylex.props(styles.amount)}>{counted ?? ''}</span>
                          <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}
            {entries.data?.nextCursor != null && (
              <p {...stylex.props(styles.moreRow)}>{format(m.participantResultsMore)}</p>
            )}
          </div>
        )}
      </AsyncSection>

      {lingering !== null && itemsById.get(lingering.entry.itemId) !== undefined && (
        <ManagedEntrySheet
          key={lingering.entry.id}
          open={open !== null}
          entry={lingering.entry as EntryDto}
          item={itemsById.get(lingering.entry.itemId)!}
          recognition={lingering.recognition}
          trail={trailOf(itemsById.get(lingering.entry.itemId)!, groupsById)}
          busy={intervene.isPending}
          onClose={() => onEntry('')}
          onIntervene={(kind, reason) =>
            intervene.mutate({ entryId: lingering.entry.id, kind, reason })
          }
        />
      )}
    </>
  )
}

/** the groups above a question, outermost first */
const trailOf = (
  item: ItemDto,
  groups: ReadonlyMap<string, { name: string; parentGroupId: string | null }>,
): readonly string[] => {
  const names: string[] = []
  let at = groups.get(item.scoreGroupId)
  // a cycle cannot happen in a saved tree, but a bound keeps a bad one from
  // hanging the screen it is drawn on
  for (let depth = 0; at !== undefined && depth < 16; depth += 1) {
    names.unshift(at.name)
    at = at.parentGroupId === null ? undefined : groups.get(at.parentGroupId)
  }
  return names
}
