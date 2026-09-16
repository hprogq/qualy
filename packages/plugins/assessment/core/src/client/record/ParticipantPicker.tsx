import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// Naming one person out of a round's roster.
//
// A roster is walked by cursor, which is why the search goes to the server:
// a dropdown that filters the page it happens to hold shows the reader three
// of fifty and hides everybody the first page did not reach. The needle
// reaches the where clause, and the walk continues from wherever it is.
//
// The number is drawn beside the name because two people share a name often
// enough that a recorder has to be able to tell which one they mean.

const PAGE = 20

const styles = stylex.create({
  trigger: { width: '100%', justifyContent: 'space-between', fontWeight: 400 },
  chosen: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  placeholder: { color: tokens.mutedForeground },
  glyph: { flexShrink: 0, opacity: 0.5 },
  panel: { minWidth: 280, padding: 0 },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 8,
  },
  searchGlass: { width: 16, height: 16, flexShrink: 0, color: tokens.mutedForeground },
  bareInput: { height: 28, borderWidth: 0, paddingInline: 0, boxShadow: 'none' },
  listBox: { maxHeight: '18rem' },
  list: { display: 'flex', flexDirection: 'column', padding: 4 },
  row: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    borderRadius: tokens.radiusMd,
    paddingInline: 8,
    paddingBlock: 6,
    textAlign: 'start',
    cursor: 'pointer',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  rowCurrent: {
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted },
  },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 1 },
  name: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  number: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  spacer: { flexGrow: 1 },
  tick: { width: 16, height: 16, flexShrink: 0 },
  note: {
    paddingInline: 12,
    paddingBlock: 20,
    textAlign: 'center',
    fontSize: '0.875rem',
    color: tokens.mutedForeground,
  },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10 },
  bone: { height: 28 },
  moreRow: { display: 'flex', justifyContent: 'center', paddingBlock: 6 },
})

export interface PickedParticipant {
  readonly id: string
  readonly displayName: string
  readonly businessNo: string | null
}

export function ParticipantPicker({
  batchId,
  value,
  onChange,
  id,
  label,
  disabled = false,
}: {
  batchId: string
  /** the chosen person, carried by the caller so the name survives a re-render */
  value: PickedParticipant | null
  onChange: (picked: PickedParticipant | null) => void
  id?: string
  /** spoken name, since the trigger reads out whoever is chosen */
  label?: string
  disabled?: boolean
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const needle = search.trim()
  const roster = useInfiniteQuery({
    queryKey: [
      ...query.assessment.listParticipants.key({ params: { batchId }, query: {} }),
      { q: needle },
      'picker',
    ],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listParticipants({
          params: { batchId },
          query: {
            status: 'active',
            limit: String(PAGE),
            ...(needle === '' ? {} : { q: needle }),
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        }),
      ),
    enabled: open,
    ...cursorPages,
  })

  const people = useMemo(
    () => roster.data?.pages.flatMap((page) => page.items) ?? [],
    [roster.data],
  )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          data-testid="participant-picker"
          {...(id === undefined ? {} : { id })}
          {...(label === undefined ? {} : { 'aria-label': label })}
          className={stylex.props(styles.trigger).className}
        >
          <span {...stylex.props(styles.chosen, value === null && styles.placeholder)}>
            {value === null ? format(m.recordPickWho) : value.displayName}
          </span>
          <ChevronsUpDownIcon
            className={stylex.props(styles.glyph).className}
            data-icon="inline-end"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" width="target" xstyle={styles.panel}>
        <div {...stylex.props(styles.searchRow)}>
          <SearchIcon aria-hidden className={stylex.props(styles.searchGlass).className} />
          <Input
            autoFocus
            aria-label={format(m.recordSearchWho)}
            placeholder={format(m.recordSearchWho)}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={stylex.props(styles.bareInput).className}
          />
        </div>
        <ScrollArea className={stylex.props(styles.listBox).className}>
          {roster.isPending ? (
            <div {...stylex.props(styles.waiting)}>
              {[0, 1, 2].map((at) => (
                <Skeleton key={at} className={stylex.props(styles.bone).className} />
              ))}
            </div>
          ) : roster.isError ? (
            <p {...stylex.props(styles.note)}>{formatError(roster.error)}</p>
          ) : people.length === 0 ? (
            <p {...stylex.props(styles.note)}>{format(m.recordNobodyFound)}</p>
          ) : (
            <>
              <ul {...stylex.props(styles.list)}>
                {people.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      data-testid="participant-option"
                      aria-current={person.id === value?.id}
                      onClick={() => {
                        onChange({
                          id: person.id,
                          displayName: person.displayName,
                          businessNo: person.businessNo,
                        })
                        setOpen(false)
                        setSearch('')
                      }}
                      {...stylex.props(styles.row, person.id === value?.id && styles.rowCurrent)}
                    >
                      <span {...stylex.props(styles.words)}>
                        <span {...stylex.props(styles.name)}>{person.displayName}</span>
                        <span {...stylex.props(styles.number)}>
                          {person.businessNo ?? format(m.noBusinessNoShort)}
                        </span>
                      </span>
                      <span {...stylex.props(styles.spacer)} />
                      {person.id === value?.id && (
                        <CheckIcon aria-hidden className={stylex.props(styles.tick).className} />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {/* the walk continues rather than stopping at the first page,
                  which is the whole reason the search is server-side */}
              {roster.hasNextPage && (
                <div {...stylex.props(styles.moreRow)}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={roster.isFetchingNextPage}
                    onClick={() => void roster.fetchNextPage()}
                  >
                    {format(m.recordMoreWho)}
                  </Button>
                </div>
              )}
            </>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
