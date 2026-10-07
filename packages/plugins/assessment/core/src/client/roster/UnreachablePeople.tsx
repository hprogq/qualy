import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { useApiQuery, useLoadFailure } from '@qualy/web-runtime'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'

import { AsyncSection } from '@qualy/ui/admin'
import { Pager } from '@qualy/ui/pager'
import { Skeleton } from '@qualy/ui/skeleton'
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
  // filling a pane of its own: the list takes the pane's height and the
  // pages stand at its foot, under a rule
  fill: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  peopleFill: {
    flexGrow: 1,
    maxHeight: 'none',
    padding: 6,
    borderRadius: 0,
    backgroundColor: 'transparent',
    overscrollBehavior: 'none',
  },
  personFill: { minHeight: 52, paddingBlock: 8 },
  personGo: { gridTemplateColumns: 'minmax(0, 12rem) minmax(0, 1fr) auto' },
  go: { width: 14, height: 14, color: tokens.mutedForeground },
  rowFill: {
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  pagesFill: {
    paddingTop: 8,
    paddingBottom: 8,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  // the room a page of people would have, so turning to the next does not jump
  waitingFill: { display: 'flex', flexDirection: 'column', gap: 8, padding: 12 },
  waitingRow: { height: 40, width: '100%' },
})

/** which route's people: a saved question's, or the unit kinds a route being composed asks for */
export type UnreachableOf =
  | { readonly itemId: string; readonly route: 'normal' | 'escalation' }
  | { readonly nodeTypeIds: readonly string[] }

export function UnreachablePeople({
  batchId,
  of,
  onOpenPerson,
  fill = false,
}: {
  batchId: string
  of: UnreachableOf
  /** open somebody's account; without it they are listed and not offered */
  onOpenPerson?: (participantId: string) => void
  /** fill a pane of its own rather than stand as a box in a dialog's body */
  fill?: boolean
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
  const section = (
    <AsyncSection
      pending={people.isPending}
      error={people.isError ? failures.of(people.error) : null}
      retrying={people.isFetching}
      loadingLabel={commonMessages.state_loading()}
      retryLabel={commonMessages.action_retry()}
      onRetry={() => void people.refetch()}
      {...(fill
        ? {
            skeleton: (
              <div {...stylex.props(styles.waitingFill)}>
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className={stylex.props(styles.waitingRow).className} />
                ))}
              </div>
            ),
          }
        : {})}
    >
      <ul
        data-testid="unreachable-people"
        data-total={total}
        {...stylex.props(styles.people, fill && styles.peopleFill)}
      >
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
            <li key={row.participantId} {...stylex.props(fill && styles.rowFill)}>
              {onOpenPerson === undefined ? (
                <div
                  data-testid="unreachable-person"
                  data-participant={row.participantId}
                  {...stylex.props(styles.person, fill && styles.personFill)}
                >
                  {said}
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="unreachable-person"
                  data-participant={row.participantId}
                  onClick={() => onOpenPerson(row.participantId)}
                  {...stylex.props(
                    styles.person,
                    fill && styles.personFill,
                    fill && styles.personGo,
                    styles.opens,
                  )}
                >
                  {said}
                  {fill && <ChevronRightIcon aria-hidden {...stylex.props(styles.go)} />}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {total > PAGE_SIZE && (
        <div {...stylex.props(styles.pages, fill && styles.pagesFill)}>
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
  return fill ? <div {...stylex.props(styles.fill)}>{section}</div> : section
}
