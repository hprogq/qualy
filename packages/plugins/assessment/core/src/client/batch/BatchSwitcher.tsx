import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react'
import { useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { Skeleton } from '@qualy/ui/skeleton'
import { Spinner } from '@qualy/ui/spinner'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { StatusBadge } from './StatusBadge.tsx'

/**
 * How many rounds the menu offers at once.
 *
 * A switcher is for the handful somebody moves between, not for the whole
 * shelf: past that the menu is a page in the wrong place, and the search
 * above it - or the list itself - is the way to the rest.
 */
const NEARBY = 10

const styles = stylex.create({
  dropdown: { overflow: 'hidden', padding: 0 },
  // No ceiling of its own: whoever mounts this measures what the row can
  // spare and hands it down, so the name takes every pixel that is going and
  // is cut only when there are none left.
  trigger: {
    display: 'flex',
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'center',
    gap: 8,
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: 'transparent',
      ':hover': tokens.border,
    },
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    paddingInline: 12,
    paddingBlock: 4,
    transitionProperty: 'color, background-color, border-color, transform',
    outline: 'none',
    boxShadow: {
      default: 'none',
      ':focus-visible': `0 0 0 2px ${tokens.focusRing}`,
    },
    transform: {
      default: null,
      ':active': 'scale(0.98)',
    },
  },
  // the popover's data-state lives on the trigger, but the open flag is
  // already ours: the same state drives the menu and the trigger's ground
  triggerOpen: {
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
  },
  triggerName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 600,
  },
  chevron: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
    transitionProperty: 'transform',
  },
  chevronFlipped: {
    transform: 'rotate(180deg)',
  },
  searchBand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 12,
  },
  searchIcon: {
    width: 16,
    height: 16,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  searchInput: {
    height: 40,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    backgroundColor: 'transparent',
    // what a person types, at the size every other field types at
    fontSize: 'var(--q-input-fz)',
    outline: 'none',
    '::placeholder': {
      color: tokens.mutedForeground,
    },
    '::-webkit-search-cancel-button': {
      display: 'none',
    },
  },
  searchSpinner: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  list: {
    maxHeight: 'min(50vh, 18rem)',
    overflowY: 'auto',
    padding: 4,
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  loadingLine: {
    height: 32,
    width: '100%',
    borderRadius: tokens.radiusMd,
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
  },
  // one shape for every round, including the open one: a switcher whose
  // current entry is a different kind of thing reads as two lists that
  // happen to touch
  row: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    borderRadius: tokens.radiusMd,
    paddingInline: 10,
    paddingBlock: 6,
    textAlign: 'left',
    fontSize: 14,
    outline: 'none',
    transitionProperty: 'color, background-color',
    backgroundColor: {
      default: 'transparent',
      ':hover': tokens.surfaceMuted,
      ':focus-visible': tokens.surfaceMuted,
    },
  },
  rowMark: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
  rowName: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowNameHere: {
    fontWeight: 500,
  },
  emptyRow: {
    paddingInline: 10,
    paddingBlock: 20,
    textAlign: 'center',
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  exitBand: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    padding: 4,
  },
  exitButton: {
    width: '100%',
    justifyContent: 'flex-start',
    gap: 10,
    paddingInline: 10,
    color: tokens.mutedForeground,
  },
  exitIcon: {
    width: 16,
    height: 16,
  },
})

// Which batch is open, and the way to another one.
//
// The switch is on the name rather than beside it: the name is what the
// reader is already looking at to know where they are, and a menu that opens
// from it needs no explaining. Nothing is loaded until it opens - a bar on
// every page of a workspace should not fetch a list nobody asked for - which
// is exactly why the first open has to say it is working rather than show an
// empty menu for as long as the round trip takes.
//
// A popover and not a dropdown menu: a menu owns the keyboard to jump between
// its items by first letter, so a search field inside one loses every
// keystroke to the typeahead.
export function BatchSwitcher({
  batchId,
  name,
  status,
  currentPhaseId,
}: {
  batchId: string
  name: string
  status: 'draft' | 'active' | 'archived'
  currentPhaseId: string | null
}) {
  const query = useApiQuery(assessmentApi)
  const navigate = usePageNavigate()
  const { format } = useI18n()
  // below a tablet the standing keeps its colour and its dot and loses its
  // word: the name of the batch is what the bar is for, and the word is what
  // pushed the stage name beside it into an ellipsis
  const narrow = useIsBelow(768)
  const [open, setOpen] = useState(false)

  const [search, setSearch] = useState('')
  // typing filters the menu, but not on every keystroke: the query settles a
  // moment after the person stops, the same way the list page's does
  const [settled, setSettled] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSettled(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])
  // a fresh question every time it opens, so yesterday's search is not what
  // greets the next person to press it
  useEffect(() => {
    if (!open) {
      setSearch('')
      setSettled('')
    }
  }, [open])

  const nearby = useQuery({
    ...query.assessment.listBatches.queryOptions({
      query: { ...(settled !== '' ? { q: settled } : {}), limit: String(NEARBY) },
    }),
    enabled: open,
    staleTime: 30_000,
    // the list holds still while a narrowed one is fetched, so the menu does
    // not collapse to nothing under the cursor between keystrokes
    placeholderData: keepPreviousData,
  })
  // the open round first when it is in the answer at all: a search that does
  // not match it simply does not list it, the same as any other round
  const answer = nearby.data?.items ?? []
  const rows = [
    ...answer.filter((row) => row.id === batchId),
    ...answer.filter((row) => row.id !== batchId),
  ]
  const searching = settled !== ''
  const waiting = nearby.isPending

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* motion lives in @qualy/ui, so the movement here is css: a plugin
            pulling its own animation library is how two of them end up in one
            bundle */}
        <button
          type="button"
          aria-label={format(m.switchBatch)}
          {...stylex.props(styles.trigger, open && styles.triggerOpen)}
        >
          <span {...stylex.props(styles.triggerName)} title={name}>
            {name}
          </span>
          <StatusBadge status={status} currentPhaseId={currentPhaseId} compact={narrow} />
          <ChevronDownIcon
            aria-hidden
            className={stylex.props(styles.chevron, open && styles.chevronFlipped).className}
          />
        </button>
      </PopoverTrigger>
      {/* Wider than the trigger on purpose: these are names people wrote,
          and a menu narrower than the bar above it would ellipsize every one.
          Three bands - search, the rounds themselves, the way out - each with
          its own edge, so the eye reads a list and not a stack of controls. */}
      <PopoverContent align="center" width="min(92vw, 26rem)" xstyle={styles.dropdown}>
        <div {...stylex.props(styles.searchBand)}>
          <SearchIcon aria-hidden className={stylex.props(styles.searchIcon).className} />
          <input
            autoFocus
            type="search"
            value={search}
            placeholder={format(m.searchPlaceholder)}
            aria-label={format(m.searchPlaceholder)}
            onChange={(event) => setSearch(event.target.value)}
            {...stylex.props(styles.searchInput)}
          />
          {nearby.isFetching && !waiting && (
            <Spinner
              aria-label={format(commonMessages.loading)}
              className={stylex.props(styles.searchSpinner).className}
            />
          )}
        </div>

        <div {...stylex.props(styles.list)}>
          {waiting ? (
            // the first open pays for a round trip; lines of the shape that is
            // coming beat an empty box that reads as "none"
            <div {...stylex.props(styles.loading)} data-testid="switcher-loading">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className={stylex.props(styles.loadingLine).className} />
              ))}
            </div>
          ) : (
            <ul {...stylex.props(styles.rows)}>
              {rows.map((row) => {
                const here = row.id === batchId
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      data-testid={here ? 'switcher-current' : undefined}
                      {...stylex.props(styles.row)}
                      onClick={() => {
                        setOpen(false)
                        if (!here) navigate('assessment/batch', { params: { batchId: row.id } })
                      }}
                    >
                      {here ? (
                        <CheckIcon aria-hidden className={stylex.props(styles.rowMark).className} />
                      ) : (
                        <span aria-hidden {...stylex.props(styles.rowMark)} />
                      )}
                      <span {...stylex.props(styles.rowName, here && styles.rowNameHere)}>
                        {row.name}
                      </span>
                      <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} />
                    </button>
                  </li>
                )
              })}
              {rows.length === 0 && (
                <li {...stylex.props(styles.emptyRow)}>
                  {format(searching ? m.noMatchTitle : m.switcherOnlyThis)}
                </li>
              )}
            </ul>
          )}
        </div>

        <div {...stylex.props(styles.exitBand)}>
          <Button
            variant="ghost"
            size="sm"
            className={stylex.props(styles.exitButton).className}
            onClick={() => {
              setOpen(false)
              navigate('assessment/batches')
            }}
          >
            <ArrowLeftIcon className={stylex.props(styles.exitIcon).className} />
            {format(m.backToList)}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
