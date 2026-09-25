import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Skeleton } from '@qualy/ui/skeleton'
import { Card, CardHead, Cell, Table, TableHead, TableRow } from '@qualy/ui/screen'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { EntryStanding } from '../entry/EntryStanding.tsx'
import { ManagedEntrySheet } from '../entry/ManagedEntrySheet.tsx'
import { sayEntryFailure } from '../entry/refusals.ts'
import { sourceLabelOf } from '../entry/source.ts'
import { useLingering } from '@qualy/ui/use-lingering'
import type { ItemDto } from '../entry/model.ts'

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
  // A column of cards, not a card holding cards: one card inside another
  // showed the outer one's ground through the inner corners - a little
  // triangle at each side of every join - and left no air between groups.
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 14,
  },
  group: { display: 'flex', minWidth: 0, flexDirection: 'column' },
  // the fold: which part of the paper the claims under it answer
  stripWord: { fontSize: 12, fontWeight: 500, color: tokens.mutedForeground },
  rows: { display: 'flex', minWidth: 0, flexDirection: 'column' },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
  under: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 },
  // its own column, so the numbers line up against each other rather than
  // against whatever length the titles happen to be
  source: { color: tokens.mutedForeground },
  empty: {
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    paddingBlock: 48,
    textAlign: 'center',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  // the grouped tables it becomes: a card head, a column head, and rows
  skStack: { display: 'flex', flexDirection: 'column', gap: 14 },
  skCard: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  skCardHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 12,
  },
  skRow: {
    display: 'grid',
    alignItems: 'center',
    gap: 12,
    gridTemplateColumns: 'minmax(0, 1fr) 6rem 7.5rem 5rem',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: 16,
    paddingBlock: 11,
    ':last-child': { borderBottomWidth: 0 },
  },
  skBone: { height: 13, borderRadius: 4 },
  skChip: { height: 20, width: '4.5rem', borderRadius: 9999 },
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
  may,
  onEntry,
}: {
  batchId: string
  participantId: string
  entryId: string
  /** the corrections this reader can make in this round at all */
  may: { readonly returnForRevision: boolean; readonly withdraw: boolean }
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
    onError: (error) => toast.error(sayEntryFailure(error, { format, formatError })),
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
        skeleton={
          <div {...stylex.props(styles.skStack)}>
            {[
              ['34%', ['58%', '42%', '66%']],
              ['26%', ['48%', '61%']],
            ].map(([head, rows], group) => (
              <div key={group} {...stylex.props(styles.skCard)}>
                <div {...stylex.props(styles.skCardHead)}>
                  <Skeleton
                    className={stylex.props(styles.skBone).className}
                    width={head as string}
                  />
                  <Skeleton className={stylex.props(styles.skBone).className} width={48} />
                </div>
                {(rows as string[]).map((width, index) => (
                  <div key={index} {...stylex.props(styles.skRow)}>
                    <Skeleton className={stylex.props(styles.skBone).className} width={width} />
                    <Skeleton className={stylex.props(styles.skBone).className} width="70%" />
                    <Skeleton className={stylex.props(styles.skChip).className} />
                    <Skeleton className={stylex.props(styles.skBone).className} width={32} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <p {...stylex.props(styles.empty)}>{format(m.participantResultsEntriesEmpty)}</p>
        ) : (
          <div {...stylex.props(styles.card)}>
            {buckets.map(([groupId, claims]) => {
              const group = groupsById.get(groupId)
              return (
                <Card key={groupId || 'ungrouped'} data-testid="claim-group">
                  <CardHead
                    title={group?.name ?? format(m.participantResultsUngrouped)}
                    note={format(m.participantResultsClaimCount, { count: claims.length })}
                  />
                  {/* the round's own table: the question, how the fact got
                      here, where it stands and what it came to - the same
                      four columns the roster reads in, rather than a run of
                      pressable cards */}
                  <Table columns="minmax(0, 1fr) 6rem 7.5rem 5rem" openable>
                    <TableHead>
                      <span>{format(m.columnItem)}</span>
                      <span>{format(m.columnEntrySource)}</span>
                      <span>{format(m.columnEntryStanding)}</span>
                      <span>{format(m.columnEntryAmount)}</span>
                    </TableHead>
                    {claims.map(({ entry }) => {
                      const item = itemsById.get(entry.itemId)
                      const counted = countedBy.get(entry.id)
                      return (
                        <TableRow
                          key={entry.id}
                          height="compact"
                          nested
                          selected={entry.id === entryId}
                          onOpen={() => onEntry(entry.id)}
                          data-testid="participant-entry"
                          data-entry={entry.id}
                        >
                          <Cell lead strong={entry.id === entryId}>
                            {item?.title ?? format(m.itemsUntitled)}
                          </Cell>
                          <Cell tone="muted">{format(sourceLabelOf(entry.source))}</Cell>
                          <Cell>
                            <EntryStanding
                              status={entry.status}
                              source={entry.source}
                              revised={entry.currentReviewInstanceId !== null}
                              asked={entry.supplement !== null}
                              openRound={entry.openRound}
                            />
                          </Cell>
                          {/* what it is worth is what this list is read
                              for, so stacked it keeps the end of the row */}
                          <Cell
                            numeric
                            narrow="end"
                            unlabelled
                            tone={counted === undefined ? 'quiet' : 'plain'}
                          >
                            {counted ?? '—'}
                          </Cell>
                        </TableRow>
                      )
                    })}
                  </Table>
                </Card>
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
          entry={lingering.entry}
          item={itemsById.get(lingering.entry.itemId)!}
          recognition={lingering.recognition}
          trail={trailOf(itemsById.get(lingering.entry.itemId)!, groupsById)}
          busy={intervene.isPending}
          may={may}
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
