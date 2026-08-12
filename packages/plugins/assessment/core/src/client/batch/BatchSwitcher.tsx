import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { cn } from '@qualy/ui/cn'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { StatusBadge } from './StatusBadge.tsx'

/** enough to choose between; the list page is where all of them are */
const NEARBY = 8

// Which batch is open, and the way to another one.
//
// The switch is on the name rather than beside it: the name is what the
// reader is already looking at to know where they are, and a menu that opens
// from it needs no explaining. The batches it offers are loaded when it is
// opened - a bar on every page of a workspace should not fetch a list nobody
// asked for.
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

  const nearby = useQuery({
    ...query.assessment.listBatches.queryOptions({ query: { limit: String(NEARBY) } }),
    enabled: open,
    staleTime: 30_000,
  })
  const others = (nearby.data?.items ?? []).filter((row) => row.id !== batchId)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {/* motion lives in @qualy/ui, so the movement here is css: a plugin
            pulling its own animation library is how two of them end up in one
            bundle */}
        <button
          type="button"
          aria-label={format(m.switchBatch)}
          // A ceiling of its own, not just min-w-0: the bar centres this
          // button between two columns that can give it more room than the
          // screen has, so a long batch name pushed the standing and the
          // chevron off the edge instead of being cut.
          className="flex min-w-0 max-w-[min(45vw,15rem)] items-center gap-2 rounded-full border border-transparent px-3 py-1 transition-[colors,transform] outline-none active:scale-[0.98] hover:border-border hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-border data-[state=open]:bg-muted/60"
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-72">
        {others.map((row) => (
          <DropdownMenuItem
            key={row.id}
            className="flex items-center gap-2"
            onSelect={() => navigate('assessment/batch', { params: { batchId: row.id } })}
          >
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem disabled className="flex items-center gap-2 opacity-100">
          <CheckIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('assessment/batches')}>
          {format(m.backToList)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
