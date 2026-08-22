import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react'
import { useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { Skeleton } from '@qualy/ui/skeleton'
import { Spinner } from '@qualy/ui/spinner'
import { cn } from '@qualy/ui/cn'
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
          // No ceiling of its own: whoever mounts this measures what the row
          // can spare and hands it down, so the name takes every pixel that
          // is going and is cut only when there are none left.
          className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-transparent px-3 py-1 transition-[colors,transform] outline-none active:scale-[0.98] hover:border-border hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-border data-[state=open]:bg-muted/60"
        >
          <span className="min-w-0 truncate text-sm font-semibold" title={name}>
            {name}
          </span>
          <StatusBadge status={status} currentPhaseId={currentPhaseId} compact={narrow} />
          <ChevronDownIcon
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </PopoverTrigger>
      {/* Wider than the trigger on purpose: these are names people wrote,
          and a menu narrower than the bar above it would ellipsize every one.
          Three bands - search, the rounds themselves, the way out - each with
          its own edge, so the eye reads a list and not a stack of controls. */}
      <PopoverContent align="center" className="w-[min(92vw,26rem)] overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b px-3">
          <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            type="search"
            value={search}
            placeholder={format(m.searchPlaceholder)}
            aria-label={format(m.searchPlaceholder)}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {nearby.isFetching && !waiting && (
            <Spinner
              aria-label={format(commonMessages.loading)}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
        </div>

        <div className="max-h-[min(50vh,18rem)] overflow-y-auto p-1">
          {waiting ? (
            // the first open pays for a round trip; lines of the shape that is
            // coming beat an empty box that reads as "none"
            <div className="flex flex-col gap-1" data-testid="switcher-loading">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-8 w-full rounded-md" />
              ))}
            </div>
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => {
                const here = row.id === batchId
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      // one shape for every round, including the open one: a
                      // switcher whose current entry is a different kind of
                      // thing reads as two lists that happen to touch
                      data-testid={here ? 'switcher-current' : undefined}
                      className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                      onClick={() => {
                        setOpen(false)
                        if (!here) navigate('assessment/batch', { params: { batchId: row.id } })
                      }}
                    >
                      {here ? (
                        <CheckIcon aria-hidden className="size-4 shrink-0" />
                      ) : (
                        <span aria-hidden className="size-4 shrink-0" />
                      )}
                      <span className={cn('min-w-0 flex-1 truncate', here && 'font-medium')}>
                        {row.name}
                      </span>
                      <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} />
                    </button>
                  </li>
                )
              })}
              {rows.length === 0 && (
                <li className="px-2.5 py-5 text-center text-sm text-muted-foreground">
                  {format(searching ? m.noMatchTitle : m.switcherOnlyThis)}
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="border-t p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2.5 px-2.5 text-muted-foreground"
            onClick={() => {
              setOpen(false)
              navigate('assessment/batches')
            }}
          >
            <ArrowLeftIcon className="size-4" />
            {format(m.backToList)}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
