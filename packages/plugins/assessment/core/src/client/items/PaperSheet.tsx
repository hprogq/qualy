import { PlusIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'
import type { ItemDto } from '../entry/model.ts'

// The paper itself, laid out the way an exam reads: numbered sections with
// what each is worth at most, questions as lines with their score at the
// margin. Everything editable is reached from the line it lives on, and
// only when the pointer is there - the resting state is just the paper.

export interface SheetGroup {
  id: string
  parentGroupId: string | null
  name: string
  cap: string | null
  floor: string | null
  sortOrder: number
}

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const numeral = (index: number) => NUMERALS[index] ?? String(index + 1)

const amountOf = (item: ItemDto): string | undefined =>
  (
    item.currentRevision?.scoringConfig as
      { calculator?: { config?: { value?: string } } } | undefined
  )?.calculator?.config?.value

export function PaperSheet({
  groups,
  items,
  onEditGroup,
  onAddGroup,
  onAddItem,
  onEditItem,
}: {
  groups: readonly SheetGroup[]
  items: readonly ItemDto[]
  onEditGroup: (group: SheetGroup) => void
  onAddGroup: (parentId: string | null) => void
  onAddItem: (groupId: string) => void
  onEditItem: (item: ItemDto) => void
}) {
  const { format } = useI18n()

  const childrenOf = new Map<string | null, SheetGroup[]>()
  for (const group of [...groups].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const bucket = childrenOf.get(group.parentGroupId)
    if (bucket === undefined) childrenOf.set(group.parentGroupId, [group])
    else bucket.push(group)
  }
  const orphans = items.filter((item) => !groups.some((group) => group.id === item.scoreGroupId))

  if (groups.length === 0 && orphans.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-8 py-16">
        <p className="text-sm text-muted-foreground">{format(m.itemsSheetEmpty)}</p>
        <Button onClick={() => onAddGroup(null)}>{format(m.itemsGroupAdd)}</Button>
      </div>
    )
  }

  const renderGroup = (group: SheetGroup, index: number, depth: number) => {
    const own = items.filter((item) => item.scoreGroupId === group.id)
    const children = childrenOf.get(group.id) ?? []
    return (
      <section key={group.id} className={cn(depth === 0 ? 'pt-8 first:pt-0' : 'pt-4')}>
        <div
          className={cn('group/heading flex items-baseline gap-2', depth === 0 && 'border-b pb-2')}
          style={depth > 0 ? { paddingLeft: `${depth * 1.5}rem` } : undefined}
        >
          <button
            type="button"
            className={cn(
              'min-w-0 truncate text-left hover:underline underline-offset-4',
              depth === 0 ? 'text-base font-semibold' : 'text-sm font-medium',
            )}
            onClick={() => onEditGroup(group)}
          >
            {depth === 0 && `${numeral(index)}、`}
            {group.name === '' ? format(m.itemsGroupUnnamed) : group.name}
          </button>
          {group.cap !== null && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {format(m.itemsCapChip, { value: group.cap })}
            </span>
          )}
          <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/heading:opacity-100 focus-within:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              onClick={() => onAddItem(group.id)}
            >
              {format(m.itemsOutlineAddItem)}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              onClick={() => onAddGroup(group.id)}
            >
              {format(m.itemsOutlineAddGroup)}
            </Button>
          </span>
        </div>

        {own.length > 0 && (
          <ol className="flex flex-col" style={{ paddingLeft: `${depth * 1.5}rem` }}>
            {own.map((item, at) => (
              <QuestionLine
                key={item.id}
                item={item}
                number={at + 1}
                onEdit={() => onEditItem(item)}
              />
            ))}
          </ol>
        )}
        {children.map((child, at) => renderGroup(child, at, depth + 1))}
      </section>
    )
  }

  return (
    <div className="rounded-lg border bg-card px-8 py-8 sm:px-12">
      {(childrenOf.get(null) ?? []).map((group, index) => renderGroup(group, index, 0))}
      {orphans.length > 0 && (
        <section className="pt-8">
          <p className="border-b pb-2 text-sm font-medium text-muted-foreground">
            {format(m.itemsOutlineOrphans)}
          </p>
          <ol className="flex flex-col">
            {orphans.map((item, at) => (
              <QuestionLine
                key={item.id}
                item={item}
                number={at + 1}
                onEdit={() => onEditItem(item)}
              />
            ))}
          </ol>
        </section>
      )}
      <div className="pt-8">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onAddGroup(null)}
        >
          <PlusIcon aria-hidden className="size-3.5" />
          {format(m.itemsGroupAdd)}
        </Button>
      </div>
    </div>
  )
}

function QuestionLine({
  item,
  number,
  onEdit,
}: {
  item: ItemDto
  number: number
  onEdit: () => void
}) {
  const { format } = useI18n()
  const amount = amountOf(item)
  const voided = item.status === 'voided'
  return (
    <li className="group/line">
      <button
        type="button"
        className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
        onClick={onEdit}
      >
        <span className="w-5 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
          {number}
        </span>
        <span
          className={cn('min-w-0 truncate text-sm', voided && 'text-muted-foreground line-through')}
        >
          {item.title}
        </span>
        {voided && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {format(m.itemsStatusVoided)}
          </span>
        )}
        {item.currentRevision?.entrySource === 'administrative' && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {format(m.itemsChipRecorded)}
          </span>
        )}
        {/* the dotted leader an exam uses to carry the eye to the score */}
        <span
          aria-hidden
          className="mx-1 flex-1 self-center border-b border-dotted border-muted-foreground/30"
        />
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {amount === undefined ? '—' : format(m.itemsScoreChip, { value: amount })}
        </span>
      </button>
    </li>
  )
}
