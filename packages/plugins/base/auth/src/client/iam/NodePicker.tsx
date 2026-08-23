import { useMemo, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { cn } from '@qualy/ui/cn'
import { iamMessages as m } from '../i18n.ts'

export type PickableNode = {
  orgNodeId: string
  name: string
  depth: number
  manageable: boolean
}

/**
 * Choosing one unit out of the tree the caller administers.
 *
 * A dropdown of flat names loses the only thing that tells two similarly
 * named units apart, so the rows keep their depth and the search keeps
 * whatever matches. Units the caller may not administer are shown and not
 * offered: seeing where something sits is part of choosing correctly.
 */
export function NodePicker({
  nodes,
  value,
  onChange,
  placeholder,
  label,
  id,
  disabled = false,
  className,
}: {
  nodes: readonly PickableNode[]
  value: string
  onChange: (orgNodeId: string) => void
  placeholder: string
  /** spoken name, since the trigger reads out whatever unit is chosen */
  label?: string
  id?: string
  disabled?: boolean
  className?: string
}) {
  const { format } = useI18n()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const current = nodes.find((node) => node.orgNodeId === value)

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === '') return nodes
    return nodes.filter((node) => node.name.toLowerCase().includes(needle))
  }, [nodes, search])

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
          {...(id === undefined ? {} : { id })}
          {...(label === undefined ? {} : { 'aria-label': label })}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span
            className={cn('min-w-0 truncate', current === undefined && 'text-muted-foreground')}
          >
            {current?.name ?? placeholder}
          </span>
          <ChevronsUpDownIcon className="shrink-0 opacity-50" data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            aria-label={format(m.nodeSearch)}
            placeholder={format(m.nodeSearch)}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <ScrollArea className="max-h-64">
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {format(m.nodeNoMatch)}
            </p>
          ) : (
            <ul className="flex flex-col p-1">
              {shown.map((node) => (
                <li key={node.orgNodeId}>
                  <button
                    type="button"
                    disabled={!node.manageable}
                    aria-current={node.orgNodeId === value}
                    onClick={() => {
                      onChange(node.orgNodeId)
                      setOpen(false)
                      setSearch('')
                    }}
                    className={cn(
                      'flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors',
                      node.manageable
                        ? 'hover:bg-accent'
                        : 'cursor-not-allowed text-muted-foreground',
                      node.orgNodeId === value && 'bg-accent',
                    )}
                    // the depth is the whole reason a name is unambiguous, so
                    // it is spacing rather than a prefix that search would eat
                    style={{ paddingLeft: `${0.5 + Math.min(node.depth, 6) * 0.75}rem` }}
                  >
                    <span className="min-w-0 truncate">{node.name}</span>
                    <span className="flex-1" />
                    {node.orgNodeId === value && (
                      <CheckIcon className="size-4 shrink-0" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
