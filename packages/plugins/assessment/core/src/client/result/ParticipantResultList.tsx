import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { UiSlot, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { orgNodePicker, personCard } from '@qualy/ui-contract'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@qualy/ui/collapsible'
import { PersonCell } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { assessmentMessages as m } from '../i18n.ts'
import { assessmentApi } from '../api.ts'

// Finding one person, and nothing else.
//
// No totals in this list, and that is a decision rather than an omission: a
// standing is not a stored number, it is one repeatable-read snapshot per
// participant with the round's arithmetic run over it. Putting a score in
// every row would run twenty-five of those to draw one page, and the page
// only exists to get somebody to the one person they came for.

const PAGE_SIZE = 25

/** the width the tree and the list stop competing for, tailwind's `lg` */
const TWO_COLUMNS = 1024

const wide = '@media (min-width: 1024px)'

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column', gap: 20 },
  columns: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: { default: null, [wide]: 'minmax(0, 18rem) minmax(0, 1fr)' },
  },
  unitsAside: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 8 },
  unitsTrigger: {
    width: '100%',
    justifyContent: 'space-between',
    paddingInline: 8,
    pointerEvents: { default: null, [wide]: 'none' },
  },
  unitsWord: { fontSize: 13, fontWeight: 500 },
  unitsChevron: {
    width: 16,
    height: 16,
    transitionProperty: 'transform',
    transitionDuration: '150ms',
    display: { default: null, [wide]: 'none' },
  },
  unitsChevronOpen: { transform: 'rotate(180deg)' },
  unitsSeat: { minWidth: 0 },
  treeSkeleton: { height: 240, width: '100%' },
  listColumn: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 12 },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    overflow: 'hidden',
  },
  // one person per ruled line: a card per row would make finding somebody a
  // matter of scrolling past twenty-five boxes
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: { default: tokens.background, ':hover': tokens.surfaceMuted },
    paddingInline: 16,
    paddingBlock: 10,
    textAlign: 'start',
    cursor: 'pointer',
    ':last-child': { borderBottomWidth: 0 },
  },
  who: { minWidth: 0, flexGrow: 1 },
  chevron: { width: 16, height: 16, flexShrink: 0, color: tokens.mutedForeground },
  empty: {
    paddingBlock: 32,
    textAlign: 'center',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  pagerRow: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  listSkeleton: { height: 320, width: '100%' },
})

export function ParticipantResultList({
  batchId,
  onOpen,
}: {
  batchId: string
  onOpen: (participantId: string) => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const [units, setUnits] = useState<readonly string[]>([])
  const [unitScope, setUnitScope] = useState<'self' | 'subtree'>('subtree')
  const narrow = useIsBelow(TWO_COLUMNS)
  const [unitsOpen, setUnitsOpen] = useState(!narrow)
  useEffect(() => setUnitsOpen(!narrow), [narrow])

  // Keyset paging walked by page, with the question it belongs to carried
  // beside it: a cursor means nothing against a question it did not come
  // from, so changing the filter starts the walk over in the same render.
  const question = `${[...units].sort().join(',')}:${unitScope}`
  const [paging, setPaging] = useState<{
    question: string
    cursors: readonly (string | undefined)[]
    at: number
  }>({ question, cursors: [undefined], at: 0 })
  const page = paging.question === question ? paging : { question, cursors: [undefined], at: 0 }
  const { cursors, at } = page
  const participants = useQuery(
    query.assessment.listParticipants.queryOptions({
      params: { batchId },
      query: {
        ...(units.length > 0 ? { orgNodeIds: [...units], orgScope: unitScope } : {}),
        ...(cursors[at] !== undefined ? { cursor: cursors[at] } : {}),
        limit: String(PAGE_SIZE),
      },
    }),
  )
  const nextCursor = participants.data?.nextCursor ?? null
  useEffect(() => {
    if (nextCursor === null || cursors[at + 1] === nextCursor) return
    setPaging({ question, cursors: [...cursors.slice(0, at + 1), nextCursor], at })
  }, [nextCursor, at, cursors, question])

  const rows = participants.data?.items ?? []

  return (
    <div {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.columns)}>
        {/* on a phone the tree is a second screenful in front of the list
            somebody came for, so it starts folded and says what it is */}
        <Collapsible
          open={unitsOpen}
          onOpenChange={setUnitsOpen}
          className={stylex.props(styles.unitsAside).className}
          asChild
        >
          <aside>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className={stylex.props(styles.unitsTrigger).className}
                aria-label={format(m.rosterUnits)}
              >
                <span {...stylex.props(styles.unitsWord)}>{format(m.rosterUnits)}</span>
                <ChevronDownIcon
                  aria-hidden
                  className={
                    stylex.props(styles.unitsChevron, unitsOpen && styles.unitsChevronOpen)
                      .className
                  }
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className={stylex.props(styles.unitsSeat).className}>
              <UiSlot
                token={orgNodePicker}
                context={{
                  single: true,
                  fill: true,
                  value: units,
                  onChange: setUnits,
                  scope: unitScope,
                  onScopeChange: setUnitScope,
                }}
                fallback={null}
                loading={<Skeleton className={stylex.props(styles.treeSkeleton).className} />}
              />
            </CollapsibleContent>
          </aside>
        </Collapsible>

        <section aria-label={format(m.participantResultsTab)} {...stylex.props(styles.listColumn)}>
          <AsyncSection
            pending={participants.isPending}
            error={participants.isError ? formatError(participants.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void participants.refetch()}
            skeleton={<Skeleton className={stylex.props(styles.listSkeleton).className} />}
          >
            {rows.length === 0 ? (
              <p {...stylex.props(styles.empty)}>{format(m.rosterEmpty)}</p>
            ) : (
              <div {...stylex.props(styles.rows)}>
                {rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    data-testid="participant-row"
                    data-participant={row.id}
                    {...stylex.props(styles.row)}
                    onClick={() => onOpen(row.id)}
                  >
                    <span {...stylex.props(styles.who)}>
                      <UiSlot
                        token={personCard}
                        context={{ userId: row.userId, name: row.displayName }}
                        fallback={
                          <PersonCell
                            name={row.displayName}
                            secondary={row.businessNo ?? format(m.noBusinessNoShort)}
                          />
                        }
                      />
                    </span>
                    {row.status === 'excluded' ? (
                      <Badge variant="secondary">{format(m.excludedBadge)}</Badge>
                    ) : (
                      <Badge variant="outline">{format(m.participantActive)}</Badge>
                    )}
                    <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                  </button>
                ))}
              </div>
            )}
          </AsyncSection>

          {(at > 0 || nextCursor !== null) && (
            <div {...stylex.props(styles.pagerRow)}>
              <Button
                size="sm"
                variant="ghost"
                disabled={at === 0}
                onClick={() => setPaging({ question, cursors, at: Math.max(0, at - 1) })}
              >
                {format(m.previousPage)}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={nextCursor === null}
                onClick={() => setPaging({ question, cursors, at: at + 1 })}
              >
                {format(m.nextPage)}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
