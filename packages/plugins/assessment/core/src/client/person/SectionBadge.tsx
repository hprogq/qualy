import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import type { NavigationBadgeContext } from '@qualy/ui-contract'
import { Count } from '@qualy/ui/count'
import { assessmentApi } from '../api.ts'

// How much this plugin holds about the open person, beside the section that
// holds it.
//
// The number cannot travel with the navigation entry: navigation is a
// manifest projection computed once per reader, and what somebody has filed
// changes while an administrator reads their record. So the shell renders
// this beside each entry and says which one; anything that is not ours
// answers with nothing at all.
//
// A page's worth is all it asks for, and a full page reads as "at least
// this many": the point is whether the section is worth opening, and paging
// the whole history to put an exact number on a rail would cost more than
// the answer is worth.
const PAGE = 20

// The count is asked once the page is up, so on a fresh page it comes a
// moment after the rail. It arrives rather than blinks in, as the rail's
// administration dot does (AdminAlertBadge); one already known when the rail
// is drawn again, moving between pages, is simply there.
const arrive = stylex.keyframes({
  from: { opacity: 0, transform: 'scale(0.6)' },
  to: { opacity: 1, transform: 'scale(1)' },
})

const styles = stylex.create({
  seat: { display: 'inline-flex', flexShrink: 0 },
  arriving: {
    animationName: { default: arrive, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
  },
})

/** this plugin's two sections of a person's record, by their rail entries' ids */
const SECTIONS = {
  batches: 'assessment/user-batches/rail',
  entries: 'assessment/user-entries/rail',
} as const

type Section = keyof typeof SECTIONS

const sectionOf = (navigationId: string | undefined): Section | null =>
  navigationId === SECTIONS.batches
    ? 'batches'
    : navigationId === SECTIONS.entries
      ? 'entries'
      : null

// the slot hands its context over as one prop, the entry's id inside it
export default function SectionBadge({ context }: { context?: NavigationBadgeContext }) {
  const section = sectionOf(context?.navigationId)
  if (section === null) return null
  return <Counted section={section} />
}

function Counted({ section }: { section: Section }) {
  const query = useApiQuery(assessmentApi)
  const { userId } = usePageRouteParams('userId')
  const batches = useQuery({
    ...query.assessment.listUserBatches.queryOptions({
      params: { userId },
      query: { limit: String(PAGE) },
    }),
    enabled: userId !== '' && section === 'batches',
    staleTime: 30_000,
  })
  const entries = useQuery({
    ...query.assessment.listUserEntries.queryOptions({
      params: { userId },
      query: { limit: String(PAGE) },
    }),
    enabled: userId !== '' && section === 'entries',
    staleTime: 30_000,
  })
  const held = section === 'batches' ? batches.data : entries.data
  const [waited] = useState(() => held === undefined)
  const rows = held?.items?.length ?? 0
  if (rows === 0) return null
  const more = held?.nextCursor != null
  return (
    <span
      data-testid="person-section-count"
      data-section={section}
      data-count={rows}
      {...stylex.props(styles.seat, waited && styles.arriving)}
    >
      <Count>{more ? `${PAGE}+` : String(rows)}</Count>
    </span>
  )
}
