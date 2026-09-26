import { useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { Count } from '@qualy/ui/count'
import { DetailSheet } from '@qualy/ui/screen'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import type { RosterWalk } from './roster-walk.ts'

// Walking from one person to the next without going back to the list.
//
// The keys step along the same rows the list beside the account shows
// (roster-walk), so the next one is always the next one there. Where the
// window lends no column for that list, where this person stands is itself
// the way to it: pressed, the list opens over the account.
//
// When the list does not hold the open person - a search that does not find
// them, somebody taken off the round - the keys stay where they are and say
// there is nowhere to step, rather than leaving the row with a hole in it.

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
  // the same words, as the way to the whole list
  opener: {
    display: 'inline-flex',
    height: 28,
    alignItems: 'center',
    gap: 2,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    paddingInline: 6,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `0 0 0 2px ${tokens.focusRing}` },
  },
  openerGlyph: { width: 14, height: 14 },
  glyph: { width: 16, height: 16 },
})

export function RosterNeighbors({
  walk,
  onOpen,
  list,
}: {
  walk: RosterWalk
  /** open this person, and put the list on the page they stand on */
  onOpen: (participantId: string, page: number) => void
  /**
   * The whole list, where it has no column of its own: drawn in a sheet
   * the place opens, and told how to close it once somebody is picked.
   */
  list?: (close: () => void) => ReactNode
}) {
  const { format } = useI18n()
  const [listing, setListing] = useState(false)
  // nobody on the list and nothing narrowing it: nobody to step to, and
  // nothing to take back
  if (walk.state === 'ready' && walk.total === 0 && !walk.narrowed) return null

  const { previous, next, here, total } = walk
  const place =
    here !== null && total !== null
      ? format(m.rosterPosition, { position: here.position, total })
      : total !== null && walk.off
        ? format(m.rosterPositionOff, { total })
        : ''

  return (
    <nav
      aria-label={format(m.rosterNeighbors)}
      data-testid="roster-neighbors"
      data-position={here?.position ?? ''}
      data-total={total ?? ''}
      data-off={walk.off || undefined}
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
      {list === undefined ? (
        place !== '' && <span {...stylex.props(styles.place)}>{place}</span>
      ) : (
        <button
          type="button"
          data-testid="roster-walk-open"
          aria-haspopup="dialog"
          aria-expanded={listing}
          aria-label={format(m.rosterWalkOpen, { place })}
          onClick={() => setListing(true)}
          {...stylex.props(styles.opener)}
        >
          {place}
          <ChevronDownIcon aria-hidden {...stylex.props(styles.openerGlyph)} />
        </button>
      )}
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
      {list !== undefined && (
        <DetailSheet
          open={listing}
          onClose={() => setListing(false)}
          title={format(m.rosterWalkHeading)}
          titleAside={total === null ? undefined : <Count>{String(total)}</Count>}
          width="narrow"
          fill
          closeLabel={format(commonMessages.close)}
          testId="roster-walk-sheet"
        >
          {list(() => setListing(false))}
        </DetailSheet>
      )}
    </nav>
  )
}
