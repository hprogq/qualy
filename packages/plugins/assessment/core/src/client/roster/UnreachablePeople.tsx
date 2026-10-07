import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, useLoadFailure } from '@qualy/web-runtime'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'

import { AsyncSection } from '@qualy/ui/admin'
import { Pager } from '@qualy/ui/pager'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentApi } from '../api.ts'

import { UNNAMED } from './unit-path.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
    minHeight: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    maxHeight: 'min(44dvh, 24rem)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  person: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: {
      default: 'minmax(0, 12rem) minmax(0, 1fr)',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 2,
    minHeight: 56,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    paddingInline: 12,
    paddingBlock: 10,
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
  identity: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  personName: { minWidth: 0, overflowWrap: 'anywhere', fontWeight: 500 },
  personNumber: {
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
    overflowWrap: 'anywhere',
    fontSize: 12,
  },
  personUnit: {
    minWidth: 0,
    color: tokens.mutedForeground,
    fontSize: 12,
    overflowWrap: 'anywhere',
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
  },
  pages: { display: 'flex', paddingTop: 8, flexShrink: 0 },
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
  const businessNo = useTerm(authTerms.businessNumber)

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
      loadingLabel={commonMessages.state_loading()}
      retryLabel={commonMessages.action_retry()}
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
              <span {...stylex.props(styles.identity)}>
                <span {...stylex.props(styles.personName)}>{row.displayName}</span>
                <span {...stylex.props(styles.personNumber)}>
                  {row.businessNo || m.roster_noBusinessNo({ businessNo })}
                </span>
              </span>
              {steps.length > 0 && (
                <span {...stylex.props(styles.personUnit)}>{steps.join(' / ')}</span>
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
            label={m.roster_unreachablePeoplePager()}
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
