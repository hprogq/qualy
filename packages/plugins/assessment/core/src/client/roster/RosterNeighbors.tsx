import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { ROSTER_PAGE_SIZE, rosterQueryOf, type RosterView } from './roster-view.ts'

// Walking from one person to the next without going back to the list.
//
// The list the reader came from is in the address, so this asks the same
// page of it again (from the cache, usually) and finds where the open person
// stands in it. At either end of the page it asks for the page beyond, and
// moving there moves the list's page with it, so going back lands on the
// row of whoever was open last. Opened from a link rather than from the
// list, the person may not be on the page at all, and then there is nothing
// to walk.
//
// Two small keys and where this person stands between them: it sits beside
// the way back to the list, in the column beside the account or at the top
// of the head over it, and a pair of worded buttons would crowd both.

const styles = stylex.create({
  strip: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
  },
  place: {
    paddingInline: 2,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  glyph: { width: 16, height: 16 },
})

export function RosterNeighbors({
  batchId,
  participantId,
  view,
  onOpen,
}: {
  batchId: string
  participantId: string
  view: RosterView
  /** open this person, and put the list on the page they stand on */
  onOpen: (participantId: string, page: number) => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const pageOf = (page: number) =>
    query.assessment.listParticipantAccounts.queryOptions({
      params: { batchId },
      query: rosterQueryOf({ ...view, page }),
    })
  const here = useQuery({ ...pageOf(view.page), placeholderData: keepPreviousData })
  const rows = here.data?.items ?? []
  const page = here.data?.page ?? view.page
  const total = here.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / ROSTER_PAGE_SIZE))
  const at = rows.findIndex((row) => row.id === participantId)
  const found = at >= 0
  const before = useQuery({
    ...pageOf(page - 1),
    enabled: found && at === 0 && page > 1,
  })
  const after = useQuery({
    ...pageOf(page + 1),
    enabled: found && at === rows.length - 1 && page < pages,
  })
  if (!found) return null

  const previous =
    at > 0
      ? { id: rows[at - 1]!.id, page }
      : page > 1 && before.data !== undefined && before.data.items.length > 0
        ? { id: before.data.items[before.data.items.length - 1]!.id, page: page - 1 }
        : null
  const next =
    at < rows.length - 1
      ? { id: rows[at + 1]!.id, page }
      : page < pages && after.data !== undefined && after.data.items.length > 0
        ? { id: after.data.items[0]!.id, page: page + 1 }
        : null
  const position = (page - 1) * ROSTER_PAGE_SIZE + at + 1

  return (
    <nav
      aria-label={format(m.rosterNeighbors)}
      data-testid="roster-neighbors"
      data-position={position}
      data-total={total}
      {...stylex.props(styles.strip)}
    >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={format(m.rosterPrevious)}
        title={format(m.rosterPrevious)}
        disabled={previous === null}
        onClick={() => previous !== null && onOpen(previous.id, previous.page)}
      >
        <ChevronLeftIcon aria-hidden {...stylex.props(styles.glyph)} />
      </Button>
      <span {...stylex.props(styles.place)}>{format(m.rosterPosition, { position, total })}</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={format(m.rosterNext)}
        title={format(m.rosterNext)}
        disabled={next === null}
        onClick={() => next !== null && onOpen(next.id, next.page)}
      >
        <ChevronRightIcon aria-hidden {...stylex.props(styles.glyph)} />
      </Button>
    </nav>
  )
}
