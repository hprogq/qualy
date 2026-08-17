import { useState } from 'react'
import { CheckIcon, ChevronDownIcon, GripVerticalIcon, PlusIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { cn } from '@qualy/ui/cn'
import { Input } from '@qualy/ui/input'
import { Choice } from './Choice.tsx'
import { assessmentMessages as m } from '../i18n.ts'
import { lastDay } from '../entry/model.ts'
import { acceptOf, FILE_KINDS, kindsOf, unwritableTokens } from '../file-kinds.ts'

// The questions inside a question: what a participant is asked to type,
// pick or attach.
//
// One line per field, in the order they will be filled, showing only what
// tells them apart - name, type, whether it is required, what it will
// accept. A line opens onto its own settings, one at a time, because eight
// controls unfolded eight times is not a form anybody can read.

export interface FieldDraft {
  /**
   * What this field is called across revisions. Minted with the key and
   * never changed; a field written before identities existed carries its
   * key here, because that is what identified it then.
   */
  id: string
  key: string
  type: 'text' | 'date' | 'attachment'
  label: string
  required: boolean
  maxLength: string
  min: string
  max: string
  maxCount: string
  maxSizeMb: string
  accept: string
}

// a module that exports anything but components cannot be hot-replaced, and
// nothing outside this file needs it
const FIELD_TYPE_LABEL = {
  text: m.itemsTypeText,
  date: m.itemsTypeDate,
  attachment: m.itemsTypeAttachment,
} as const

/**
 * The columns a field line reads across, once there is room for them.
 *
 * Four rather than five: what used to be the "required" column is now a mark
 * beside the name, because a column whose every cell reads the same word is
 * a column that costs width and says nothing.
 */
const COLUMNS_AT_SM =
  'sm:grid-cols-[2.25rem_minmax(0,1fr)_6.25rem_12.5rem_1.5rem] sm:gap-x-3 sm:gap-y-0'

export function FieldList({
  fields,
  materialRange,
  openKey,
  onOpen,
  onChange,
  onReorder,
  onRemove,
  onAdd,
}: {
  fields: readonly FieldDraft[]
  /** the round's own window; a date field can only narrow it, never widen it */
  materialRange: { start: string; end: string }
  /** which line is open; only one is, so the list keeps its shape */
  openKey: string | null
  onOpen: (key: string | null) => void
  onChange: (key: string, next: Partial<FieldDraft>) => void
  onReorder: (orderedKeys: readonly string[]) => void
  onRemove: (key: string) => void
  onAdd: () => void
}) {
  const { format } = useI18n()
  const [drop, setDrop] = useState<{ key: string; edge: 'before' | 'after' } | null>(null)
  const required = fields.filter((field) => field.required).length

  const edgeOf = (event: React.DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY < box.top + box.height / 2 ? ('before' as const) : ('after' as const)
  }

  const move = (dragged: string, target: string, edge: 'before' | 'after') => {
    if (dragged === target) return
    const order = fields.map((field) => field.key).filter((key) => key !== dragged)
    const at = order.indexOf(target)
    order.splice(edge === 'before' ? at : at + 1, 0, dragged)
    onReorder(order)
  }

  /**
   * What this field actually restricts, or nothing at all.
   *
   * Only limits somebody set. It used to print "no limit" on every text
   * field and the whole round's window on every date field, so four rows
   * carried the same eight words and none of them said anything. A field
   * with nothing set says so with a dash, and the eye goes to the ones that
   * do.
   */
  const limitOf = (field: FieldDraft): string => {
    if (field.type === 'date') {
      const from = field.min.trim()
      const until = field.max.trim()
      if (from === '' && until === '') return ''
      return format(m.itemsLimitDates, {
        from: from === '' ? materialRange.start : from,
        until: until === '' ? lastDay(materialRange.end) : until,
      })
    }
    if (field.type === 'attachment') {
      return format(m.itemsLimitFiles, { count: Number(field.maxCount) || 1 })
    }
    return field.maxLength.trim() === ''
      ? ''
      : format(m.itemsLimitMaxLength, { count: Number(field.maxLength) })
  }

  return (
    <div className="flex flex-col">
      {/* What the header row used to be. Column names over rows this short
          were four labels explaining four words; what is worth saying above
          the list is how much of it there is, and that a row opens. */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b pb-2 text-xs text-muted-foreground">
        <span>{format(m.itemsFieldCount, { count: fields.length })}</span>
        {required > 0 && (
          <>
            <span aria-hidden className="h-3 w-px bg-border" />
            <span>{format(m.itemsRequiredCount, { count: required })}</span>
          </>
        )}
        <span className="flex-1" />
        {fields.length > 0 && <span>{format(m.itemsFieldOpenHint)}</span>}
      </div>

      {fields.length === 0 && (
        <p className="py-3 text-sm text-muted-foreground">{format(m.itemsFormEmpty)}</p>
      )}

      {fields.map((field, index) => {
        const marked = drop?.key === field.key ? drop.edge : null
        const open = openKey === field.key
        return (
          <div key={field.key}>
            <div
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('qualy/field', field.key)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('qualy/field')) return
                event.preventDefault()
                setDrop({ key: field.key, edge: edgeOf(event) })
              }}
              onDragLeave={() => setDrop((mark) => (mark?.key === field.key ? null : mark))}
              onDrop={(event) => {
                event.preventDefault()
                setDrop(null)
                const dragged = event.dataTransfer.getData('qualy/field')
                if (dragged !== '') move(dragged, field.key, edgeOf(event))
              }}
              onClick={() => onOpen(open ? null : field.key)}
              className={cn(
                'cursor-pointer border-b border-border/60 px-0.5 transition-colors hover:bg-accent/30',
                'grid grid-cols-[2.25rem_minmax(0,1fr)_1.5rem] items-center gap-x-3 gap-y-0.5 py-2',
                'sm:py-1.5',
                COLUMNS_AT_SM,
                marked === 'before' && 'shadow-[inset_0_2px_0_0_var(--primary)]',
                marked === 'after' && 'shadow-[inset_0_-2px_0_0_var(--primary)]',
              )}
            >
              <span className="flex items-center gap-1.5">
                <GripVerticalIcon
                  aria-hidden
                  className="size-3.5 cursor-grab text-muted-foreground/60"
                />
                {/* the order is the thing "fill these in in this order"
                    refers to, and it was the one fact the row never showed */}
                <span className="w-3 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-sm">
                  {field.label.trim() === '' ? format(m.itemsFieldUnnamed) : field.label}
                </span>
                {/* required as a mark on the name rather than a column of its
                    own: it is a fact about this field, and a column of the
                    same word repeated said nothing */}
                {field.required && (
                  <>
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />
                    <span className="sr-only">{format(m.itemsFieldRequired)}</span>
                  </>
                )}
              </span>
              <span className="hidden text-sm sm:block">
                {format(FIELD_TYPE_LABEL[field.type])}
              </span>
              <span className="hidden truncate text-xs text-muted-foreground sm:block">
                {limitOf(field) === '' ? (
                  <span className="text-muted-foreground/50">—</span>
                ) : (
                  limitOf(field)
                )}
              </span>
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  'size-3.5 justify-self-end text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
              />
              {/* what the columns would have said, on its own line */}
              <span className="col-start-2 text-xs text-muted-foreground sm:hidden">
                {[
                  format(FIELD_TYPE_LABEL[field.type]),
                  field.required ? format(m.itemsFieldRequired) : '',
                  limitOf(field),
                ]
                  .filter((fact) => fact !== '')
                  .join(` ${format(m.listSeparator).trim()} `)}
              </span>
            </div>
            {open && (
              <FieldSettings
                field={field}
                materialRange={materialRange}
                onChange={(next) => onChange(field.key, next)}
                onRemove={() => onRemove(field.key)}
              />
            )}
          </div>
        )
      })}

      <div className="pt-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onAdd}>
          <PlusIcon aria-hidden />
          {format(m.itemsFieldAdd)}
        </Button>
      </div>
    </div>
  )
}

/** one field's settings, opened in place under its own line */
function FieldSettings({
  field,
  materialRange,
  onChange,
  onRemove,
}: {
  field: FieldDraft
  materialRange: { start: string; end: string }
  onChange: (next: Partial<FieldDraft>) => void
  onRemove: () => void
}) {
  const { format } = useI18n()
  return (
    <div className="grid gap-4 border-b border-border/60 bg-muted px-3 py-3.5 sm:grid-cols-2">
      <Field label={format(m.itemsFieldLabel)}>
        {(id) => (
          <Input
            id={id}
            autoFocus
            className="bg-background"
            value={field.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        )}
      </Field>
      <Field label={format(m.itemsFieldType)}>
        {(id) => (
          <Choice
            id={id}
            className="bg-background"
            value={field.type}
            options={[
              { value: 'text', label: format(m.itemsTypeText) },
              { value: 'date', label: format(m.itemsTypeDate) },
              { value: 'attachment', label: format(m.itemsTypeAttachment) },
            ]}
            onChange={(next) => onChange({ type: next as FieldDraft['type'] })}
          />
        )}
      </Field>

      {field.type === 'text' && (
        <Field label={format(m.itemsFieldMaxLength)}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              className="bg-background"
              value={field.maxLength}
              onChange={(event) => onChange({ maxLength: event.target.value })}
            />
          )}
        </Field>
      )}

      {field.type === 'date' && (
        <>
          <Field label={format(m.itemsFieldMinDate)}>
            {(id) => (
              <Input
                id={id}
                type="date"
                className="bg-background"
                value={field.min}
                min={materialRange.start}
                max={lastDay(materialRange.end)}
                onChange={(event) => onChange({ min: event.target.value })}
              />
            )}
          </Field>
          <Field label={format(m.itemsFieldMaxDate)}>
            {(id) => (
              <Input
                id={id}
                type="date"
                className="bg-background"
                value={field.max}
                min={materialRange.start}
                max={lastDay(materialRange.end)}
                onChange={(event) => onChange({ max: event.target.value })}
              />
            )}
          </Field>
          {/* the round decides the outer window; a bound outside it changes
              nothing, and silence about that is how a date the form seemed to
              accept came back refused */}
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {format(m.itemsDateWindow, {
              from: materialRange.start,
              until: lastDay(materialRange.end),
            })}
          </p>
        </>
      )}

      {field.type === 'attachment' && (
        <>
          <Field label={format(m.itemsFieldMaxCount)}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                className="bg-background"
                value={field.maxCount}
                onChange={(event) => onChange({ maxCount: event.target.value })}
              />
            )}
          </Field>
          <Field label={format(m.itemsFieldMaxSize)}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                className="bg-background"
                value={field.maxSizeMb}
                onChange={(event) => onChange({ maxSizeMb: event.target.value })}
              />
            )}
          </Field>
          <div className="sm:col-span-2">
            <AcceptPicker accept={field.accept} onChange={(accept) => onChange({ accept })} />
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-3 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={field.required}
            onCheckedChange={(next) => onChange({ required: next === true })}
          />
          {format(m.itemsFieldRequired)}
        </label>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
          {format(m.itemsFieldRemove)}
        </Button>
      </div>
    </div>
  )
}

/**
 * What a file field will take, picked rather than typed.
 *
 * It used to be one text box with "comma separated, like .pdf, image/*"
 * under it: an administrator had to know the notation before they dared fill
 * it in, a wrong guess only surfaced when a participant's upload was
 * refused, and so most were left empty. The kinds are named in words, and
 * each one shows the notation it stands for - so the box below, which is
 * still there for the format nobody anticipated, has a worked example above
 * it every time.
 *
 * The stored value never changes shape: it is the same list of tokens
 * either way, and what is shown here is derived back out of it.
 */
function AcceptPicker({ accept, onChange }: { accept: string; onChange: (next: string) => void }) {
  const { format } = useI18n()
  const stored = accept
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '')
  const { picked, rest } = kindsOf(stored)
  const [custom, setCustom] = useState(rest.join(', '))
  // unticking hides the box without throwing away what was typed in it: the
  // question is "does this field take anything else", not "delete that"
  const [other, setOther] = useState(rest.length > 0)

  const write = (nextPicked: readonly string[], nextCustom: string, nextOther: boolean) =>
    onChange(acceptOf(nextPicked, nextOther ? nextCustom : '').join(', '))

  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((one) => one !== id) : [...picked, id]
    write(next, custom, other)
  }

  const resolved = acceptOf(picked, other ? custom : '')
  const unwritable = other ? unwritableTokens(custom) : []

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{format(m.itemsFieldAccept)}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {FILE_KINDS.map((kind) => {
          const on = picked.includes(kind.id)
          return (
            <button
              key={kind.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(kind.id)}
              className={cn(
                'flex flex-col gap-1 rounded-lg border p-2.5 text-left transition-colors',
                on ? 'border-foreground bg-accent/50' : 'bg-background hover:bg-accent/40',
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'flex size-3.5 shrink-0 items-center justify-center rounded border',
                    on ? 'border-foreground bg-foreground text-background' : 'border-input',
                  )}
                >
                  {on && <CheckIcon className="size-2.5" />}
                </span>
                <span className="text-sm">{format(kind.name)}</span>
              </span>
              {/* the notation it stands for, so the custom box below has a
                  worked example above it */}
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {kind.tokens.join(', ')}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border bg-background p-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={other}
            onCheckedChange={(next) => {
              setOther(next === true)
              write(picked, custom, next === true)
            }}
          />
          {format(m.itemsAcceptOther)}
        </label>
        {other && (
          <>
            <Input
              className="font-mono text-xs"
              value={custom}
              placeholder="application/vnd.ms-outlook"
              onChange={(event) => {
                setCustom(event.target.value)
                write(picked, event.target.value, true)
              }}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {format(m.itemsAcceptOtherHint)}
            </p>
            {unwritable.length > 0 && (
              <p className="text-xs text-destructive">
                {format(m.itemsAcceptUnwritable, { tokens: unwritable.join('、') })}
              </p>
            )}
          </>
        )}
      </div>

      {/* what the two halves add up to, which is the only thing stored */}
      <div className="flex items-baseline gap-3 rounded-lg bg-muted px-3 py-2">
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {format(m.itemsAcceptResolved)}
        </span>
        <span className="min-w-0 font-mono text-xs">
          {resolved.length === 0 ? format(m.itemsAcceptAny) : resolved.join(', ')}
        </span>
      </div>
    </div>
  )
}
