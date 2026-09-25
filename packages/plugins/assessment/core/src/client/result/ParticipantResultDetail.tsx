import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { isApiErrorCode, useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, PageHeader, BannerBack } from '@qualy/ui/admin'
import { toast } from '@qualy/ui/toast'
import { Button } from '@qualy/ui/button'
import { Count } from '@qualy/ui/count'
import { Skeleton } from '@qualy/ui/skeleton'
import { Swap } from '@qualy/ui/reveal'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchBanner } from '../batch/BatchScreen.tsx'
import { inZone, useBatchZone } from '../batch/zone.ts'
import { useBatchLive } from '../live.ts'
import { ResultLedger } from './ResultLedger.tsx'
import { ParticipantEntries } from './ParticipantEntries.tsx'
import { useParticipantEntries } from './participant-entries.ts'

// One participant's whole account, in the page the list came from.
//
// The band at the top of the screen becomes this person: who they are, where
// they stand in the organization and on this round's roster, and the ways to
// the people either side of them in the list. That is what `BatchBanner` is
// for, and it is why there is no second heading here.
//
// Two halves, because there are two questions: what was filed and decided,
// read in the same workspace the person files in, and what the total came
// to. They are the same facts read two ways, so either hands off to the
// other - a score line leads to the filing that earned it.

const styles = stylex.create({
  column: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 12 },
  truncate: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  titleLine: {
    display: 'inline-flex',
    minWidth: 0,
    maxWidth: '100%',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 4,
  },
  // the roster standing as a chip beside the name: counted in, or taken off
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 22,
    borderRadius: 6,
    paddingInline: 8,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  chipActive: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 15%, transparent)`,
    color: tokens.successForeground,
  },
  chipExcluded: { backgroundColor: tokens.surfaceMuted, color: tokens.surfaceMutedForeground },
  chipMoved: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 16%, transparent)`,
    color: tokens.warningForeground,
  },
  facts: {
    display: 'inline-flex',
    minWidth: 0,
    maxWidth: '100%',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 2,
  },
  fact: { display: 'inline-flex', minWidth: 0, alignItems: 'center', gap: 8 },
  factRule: { width: 1, height: 10, flexShrink: 0, backgroundColor: tokens.border },
  path: {
    minWidth: 0,
    maxWidth: '36em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  neighbours: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  tab: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingInline: 12,
    paddingBlock: 10,
    fontSize: 14,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  tabOn: { color: tokens.foreground, fontWeight: 600 },
  tabInk: {
    position: 'absolute',
    insetInline: 8,
    bottom: -1,
    height: 2,
    borderRadius: 999,
    backgroundColor: tokens.foreground,
  },
  // the same shape the name and the number take, so nothing moves when the
  // words arrive
  nameBone: { height: 22, width: 128 },
  numberBone: { height: 14, width: 88 },
  // the account's own shape: the total band with its bar, then a line per
  // score group - which is what lands a moment later
  skBand: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 18,
  },
  skTotal: { display: 'flex', flexShrink: 0, flexDirection: 'column', gap: 8 },
  skBars: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 10 },
  skGroups: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 16 },
  skGroupRow: {
    display: 'grid',
    alignItems: 'center',
    gap: 12,
    gridTemplateColumns: 'minmax(0, 1fr) 4rem',
  },
  skBone: { height: 13, borderRadius: 4 },
  unavailable: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 20,
  },
  unavailableTitle: { fontSize: 15, fontWeight: 600 },
  unavailableHint: { fontSize: 13, lineHeight: 1.625, color: tokens.mutedForeground },
})

/** the people either side of this one in the list the reader came from */
export interface Neighbours {
  readonly previous: { readonly id: string; readonly name: string } | null
  readonly next: { readonly id: string; readonly name: string } | null
  readonly onGo: (participantId: string) => void
}

export function ParticipantResultDetail({
  batchId,
  participantId,
  manageable,
  writable,
  mayRecord,
  view,
  entryId,
  neighbours,
  onView,
  onEntry,
  onFollow,
  onBack,
}: {
  batchId: string
  participantId: string
  /** whether this reader may take somebody off the round or put them back */
  manageable: boolean
  /** false once the round is archived: it is kept as it closed */
  writable: boolean
  /** whether this reader holds the power that records, and so withdraws, a determination */
  mayRecord: boolean
  view: 'score' | 'entries'
  /** which claim is open, if any; the drawer over either half */
  entryId: string
  /** the list's neighbours, where the page knows them */
  neighbours?: Neighbours
  onView: (next: 'score' | 'entries') => void
  onEntry: (entryId: string) => void
  /** open a claim AND the half it lives on, in one move */
  onFollow: (entryId: string) => void
  onBack: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const [excluding, setExcluding] = useState(false)
  const { format, formatError, locale } = useI18n()
  const zone = useBatchZone()
  const businessNo = useTerm(authTerms.businessNumber)

  // Wake-ups carry no facts - they say "read again" - so each kind names
  // exactly what it could have changed. Invalidating everything on every
  // event would throw away the roster, the paper and the batch on a wake-up
  // about one claim, which is a page that flickers for no reason.
  useBatchLive(batchId, (kind) => {
    const stale = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key })
    const account = () => {
      stale(
        query.assessment.listParticipantEntries.key({
          params: { batchId, participantId },
          query: {},
        }),
      )
      stale(query.assessment.getParticipantResult.key({ params: { batchId, participantId } }))
    }
    switch (kind) {
      // a fresh connection, or a phase that may have moved what staff may do
      case 'sync':
      case 'phase-changed':
        stale(query.assessment.key())
        return
      // a decision changes both what the claim says and what it counts for
      case 'entries-changed':
      case 'review-instance-changed':
      case 'result-changed':
        account()
        return
      // the paper itself moved: the ledger is grouped by it, and every
      // amount is computed from the arithmetic it carries
      case 'item-changed':
        stale(query.assessment.listItems.key({ params: { batchId } }))
        stale(query.assessment.listScoreGroups.key({ params: { batchId } }))
        stale(query.assessment.getParticipantResult.key({ params: { batchId, participantId } }))
        return
      default:
        return
    }
  })

  const who = useQuery(
    query.assessment.getParticipant.queryOptions({ params: { batchId, participantId } }),
  )
  const result = useQuery(
    query.assessment.getParticipantResult.queryOptions({ params: { batchId, participantId } }),
  )
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const entries = useQuery(useParticipantEntries(batchId, participantId))
  // Where they stand, in names: the round's units as this reader may see
  // them, and the kinds of person. Both are optional reading - a reader who
  // cannot see a unit's name is shown the rest of the path without it, and
  // one who reads neither sees the person without it.
  const units = useQuery({
    ...query.assessment.listRosterUnits.queryOptions({ params: { batchId }, query: {} }),
    staleTime: 60_000,
    retry: false,
  })
  const kinds = useQuery({
    ...query.assessment.listUserTypeOptions.queryOptions({}),
    staleTime: 300_000,
    retry: false,
  })

  const participant = who.data?.participant
  const claims = entries.data?.entries ?? []
  // The arithmetic behind the account is out of reach. Not an error to read
  // past: the last total it gave is not the current one, so the ledger is
  // not drawn at all and the one thing offered is to ask again.
  const unavailable =
    result.error !== null && isApiErrorCode(result.error, 'ASSESSMENT_SCORING_UNAVAILABLE')

  const unitNames = new Map((units.data?.units ?? []).map((unit) => [unit.id, unit.name] as const))
  const path =
    participant === undefined
      ? []
      : participant.anchorLineage.flatMap((step) => {
          const name = unitNames.get(step.nodeId)
          return name === undefined ? [] : [name]
        })
  const kind = (kinds.data?.userTypes ?? []).find((one) => one.id === participant?.userTypeId)
  const dayOf = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...inZone(zone),
    }).format(new Date(iso))

  // Taking somebody off the round, or putting them back. It belongs to the
  // person rather than to the list: the list is how somebody is found, and
  // this is the page that says what taking them off would leave behind.
  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'excluded') =>
      run(
        api.assessment.setParticipantStatus({
          params: { batchId, participantId },
          payload: { status },
        }),
      ).then((answer) => ({ ...answer, status })),
    onSuccess: (answer: { status: 'active' | 'excluded' }) => {
      setExcluding(false)
      toast.success(format(answer.status === 'excluded' ? m.toastExcluded : m.toastRestored))
      void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const facts =
    participant === undefined
      ? []
      : [
          {
            key: 'number',
            text: participant.businessNo ?? format(m.noBusinessNoShort, { businessNo }),
          },
          ...(path.length > 0 ? [{ key: 'unit', text: path.join(' / ') }] : []),
          ...(kind !== undefined ? [{ key: 'kind', text: kind.name }] : []),
          {
            key: 'roster',
            text:
              participant.status === 'excluded' && participant.excludedAt !== null
                ? format(m.participantExcludedOn, { date: dayOf(participant.excludedAt) })
                : format(m.participantIncludedOn, { date: dayOf(participant.includedAt) }),
          },
        ]

  return (
    <div {...stylex.props(styles.column)}>
      {/* The band above stops being the section and becomes this person.
          Always rendered, never waited for: the page hands the band over the
          moment somebody is chosen, so a banner that only appeared once the
          name had loaded would leave the band empty for as long as the
          request took. The shape is the same either way; only the words
          arrive late. */}
      <BatchBanner>
        <PageHeader
          variant="banner"
          title={
            participant === undefined ? (
              <Skeleton className={stylex.props(styles.nameBone).className} />
            ) : (
              <span {...stylex.props(styles.titleLine)}>
                <span {...stylex.props(styles.truncate)}>{participant.displayName}</span>
                <span
                  data-testid="participant-roster"
                  data-status={participant.status}
                  {...stylex.props(
                    styles.chip,
                    participant.status === 'excluded' ? styles.chipExcluded : styles.chipActive,
                  )}
                >
                  {format(
                    participant.status === 'excluded' ? m.excludedBadge : m.participantActive,
                  )}
                </span>
                {participant.placement !== 'current' && (
                  <span
                    data-testid="participant-placement"
                    data-placement={participant.placement}
                    {...stylex.props(styles.chip, styles.chipMoved)}
                  >
                    {format(
                      participant.placement === 'changed'
                        ? m.participantPlacementChanged
                        : m.participantPlacementGone,
                    )}
                  </span>
                )}
              </span>
            )
          }
          actions={
            <>
              {neighbours !== undefined &&
                (neighbours.previous !== null || neighbours.next !== null) && (
                  <span {...stylex.props(styles.neighbours)}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      data-testid="participant-previous"
                      disabled={neighbours.previous === null}
                      aria-label={
                        neighbours.previous === null
                          ? format(m.participantPrevious)
                          : format(m.participantPreviousNamed, { name: neighbours.previous.name })
                      }
                      onClick={() =>
                        neighbours.previous !== null && neighbours.onGo(neighbours.previous.id)
                      }
                    >
                      <ChevronLeftIcon aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      data-testid="participant-next"
                      disabled={neighbours.next === null}
                      aria-label={
                        neighbours.next === null
                          ? format(m.participantNext)
                          : format(m.participantNextNamed, { name: neighbours.next.name })
                      }
                      onClick={() =>
                        neighbours.next !== null && neighbours.onGo(neighbours.next.id)
                      }
                    >
                      <ChevronRightIcon aria-hidden />
                    </Button>
                  </span>
                )}
              {manageable && writable && participant !== undefined && (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="participant-standing"
                  disabled={setStatus.isPending}
                  onClick={() =>
                    participant.status === 'excluded'
                      ? setStatus.mutate('active')
                      : // taking somebody off is worth a question, because
                        // what it keeps is not obvious
                        setExcluding(true)
                  }
                >
                  {format(participant.status === 'excluded' ? m.restore : m.exclude)}
                </Button>
              )}
            </>
          }
          description={
            <span {...stylex.props(styles.facts)}>
              {/* text-sized rather than a button's own size: a control as
                  tall as a control in a line of prose makes that line taller
                  than the same line in the heading it took over */}
              <BannerBack label={format(m.participantResultsBack)} onBack={onBack} />
              {participant === undefined ? (
                <Skeleton className={stylex.props(styles.numberBone).className} />
              ) : (
                facts.map((fact) => (
                  <span key={fact.key} data-fact={fact.key} {...stylex.props(styles.fact)}>
                    <span aria-hidden {...stylex.props(styles.factRule)} />
                    <span
                      {...stylex.props(fact.key === 'unit' ? styles.path : styles.truncate)}
                      title={fact.key === 'unit' ? fact.text : undefined}
                    >
                      {fact.text}
                    </span>
                  </span>
                ))
              )}
            </span>
          }
        />
      </BatchBanner>

      <div {...stylex.props(styles.tabBar)}>
        {(
          [
            ['score', m.participantResultsScoreTab, null],
            ['entries', m.participantResultsEntriesTab, claims.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            data-testid={`participant-tab-${key}`}
            aria-current={view === key}
            onClick={() => onView(key)}
            {...stylex.props(styles.tab, view === key && styles.tabOn)}
          >
            {format(label)}
            {count !== null && <Count>{String(count)}</Count>}
            {view === key && <span aria-hidden {...stylex.props(styles.tabInk)} />}
          </button>
        ))}
      </div>

      {/* the two halves replace each other in place, seen to change */}
      <Swap swapKey={view}>
        {view === 'entries' ? (
          <ParticipantEntries
            batchId={batchId}
            participantId={participantId}
            entryId={entryId}
            may={{
              returnForRevision: writable && manageable,
              withdraw: writable && mayRecord,
              record: writable && mayRecord,
            }}
            onEntry={onEntry}
          />
        ) : unavailable ? (
          <section {...stylex.props(styles.unavailable)} data-testid="result-unavailable">
            <p {...stylex.props(styles.unavailableTitle)}>{format(m.resultUnavailableTitle)}</p>
            <p {...stylex.props(styles.unavailableHint)}>{format(m.resultUnavailableHint)}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={result.isFetching}
              onClick={() => void result.refetch()}
            >
              {format(m.resultRecalculate)}
            </Button>
          </section>
        ) : (
          <AsyncSection
            pending={result.isPending || items.isPending || entries.isPending || who.isPending}
            error={result.error ? formatError(result.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => {
              void result.refetch()
              void items.refetch()
              void entries.refetch()
            }}
            skeleton={
              <div>
                <div {...stylex.props(styles.skBand)}>
                  <span {...stylex.props(styles.skTotal)}>
                    <Skeleton className={stylex.props(styles.skBone).className} width={64} />
                    <Skeleton height={34} width={96} radius={6} />
                  </span>
                  <span {...stylex.props(styles.skBars)}>
                    <Skeleton height={12} radius={9999} />
                    <Skeleton className={stylex.props(styles.skBone).className} width="60%" />
                  </span>
                </div>
                <div {...stylex.props(styles.skGroups)}>
                  {['52%', '38%', '61%', '44%'].map((width, index) => (
                    <div key={index} {...stylex.props(styles.skGroupRow)}>
                      <Skeleton className={stylex.props(styles.skBone).className} width={width} />
                      <Skeleton className={stylex.props(styles.skBone).className} />
                    </div>
                  ))}
                </div>
              </div>
            }
          >
            {result.data !== undefined && (
              <ResultLedger
                result={result.data}
                items={items.data?.items ?? []}
                entries={claims.map((one) => one.entry)}
                // a number leads back to the filing it came from; this is
                // the reason the two halves are one page
                onEntryOpen={onFollow}
              />
            )}
          </AsyncSection>
        )}
      </Swap>
      <ConfirmDialog
        open={excluding}
        title={format(m.excludeTitle, { name: participant?.displayName ?? '' })}
        description={format(m.excludeBody)}
        confirmLabel={format(m.exclude)}
        cancelLabel={format(commonMessages.cancel)}
        pending={setStatus.isPending}
        tone="destructive"
        onConfirm={() => setStatus.mutate('excluded')}
        onCancel={() => setExcluding(false)}
      />
    </div>
  )
}
