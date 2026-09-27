import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, useLoadFailure } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Pager } from '@qualy/ui/pager'
import { UnitPath } from '@qualy/ui/unit-path'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { UNNAMED } from './unit-path.ts'

// The people on the roster a review route finds nowhere (§32.93), a page at
// a time: for a saved question's route, or for the unit kinds a route still
// being composed asks for. Each opens on a press where the screen showing
// them has somewhere to open them; otherwise they are only listed.

/** people per page */
const PAGE_SIZE = 10

const styles = stylex.create({
  people: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyleType: 'none',
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
  },
  person: {
    display: 'grid',
    width: '100%',
    // the same columns on every row, so the numbers and units line up down
    // the list; a long name gives way first
    gridTemplateColumns: {
      default: 'minmax(0, 10rem) 6.5rem minmax(0, 1fr)',
      [breakpoints.phone]: 'minmax(0, 1fr) auto',
    },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 2,
    minHeight: 36,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    paddingInline: 10,
    paddingBlock: 6,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 13,
    textAlign: 'start',
    color: tokens.foreground,
  },
  opens: {
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `inset 0 0 0 2px ${tokens.focusRing}` },
  },
  personName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  personNumber: {
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  personUnit: {
    display: 'flex',
    minWidth: 0,
    color: tokens.mutedForeground,
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
  },
  pages: { display: 'flex', paddingTop: 4 },
})

/** which route's people: a saved question's, or the unit kinds a route being composed asks for */
export type UnreachableOf =
  | { readonly itemId: string; readonly route: 'normal' | 'escalation' }
  | { readonly nodeTypeIds: readonly string[] }

export function UnreachablePeople({
  batchId,
  of,
  onOpenPerson,
}: {
  batchId: string
  of: UnreachableOf
  /** open somebody's account; without it they are listed and not offered */
  onOpenPerson?: (participantId: string) => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const failures = useLoadFailure()
  const [page, setPage] = useState(1)
  const asked =
    'itemId' in of ? { itemId: of.itemId, route: of.route } : { nodeTypeIds: [...of.nodeTypeIds] }
  const people = useQuery({
    ...query.assessment.listUnreachableParticipants.queryOptions({
      params: { batchId },
      query: { ...asked, page: String(page), limit: String(PAGE_SIZE) },
    }),
    placeholderData: keepPreviousData,
  })
  const rows = people.data?.items ?? []
  const total = people.data?.total ?? 0
  return (
    <AsyncSection
      pending={people.isPending}
      error={people.isError ? failures.of(people.error) : null}
      retrying={people.isFetching}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void people.refetch()}
    >
      <ul data-testid="unreachable-people" data-total={total} {...stylex.props(styles.people)}>
        {rows.map((row) => {
          // said from the top down, less the root everybody shares
          const steps = (row.unitPath.length > 1 ? row.unitPath.slice(1) : row.unitPath).map(
            (name) => name ?? UNNAMED,
          )
          const said = (
            <>
              <span title={row.displayName} {...stylex.props(styles.personName)}>
                {row.displayName}
              </span>
              <span {...stylex.props(styles.personNumber)}>{row.businessNo ?? ''}</span>
              {steps.length > 0 && (
                <span {...stylex.props(styles.personUnit)}>
                  <UnitPath steps={steps} />
                </span>
              )}
            </>
          )
          return (
            <li key={row.participantId}>
              {onOpenPerson === undefined ? (
                <div
                  data-testid="unreachable-person"
                  data-participant={row.participantId}
                  {...stylex.props(styles.person)}
                >
                  {said}
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="unreachable-person"
                  data-participant={row.participantId}
                  onClick={() => onOpenPerson(row.participantId)}
                  {...stylex.props(styles.person, styles.opens)}
                >
                  {said}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {total > PAGE_SIZE && (
        <div {...stylex.props(styles.pages)}>
          <Pager
            compact
            testId="unreachable-pager"
            label={format(m.unreachablePeoplePager)}
            page={people.data?.page ?? page}
            pageSize={PAGE_SIZE}
            total={total}
            disabled={people.isFetching}
            onPage={setPage}
          />
        </div>
      )}
    </AsyncSection>
  )
}
