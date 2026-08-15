import { useState } from 'react'
import { ChevronDownIcon, GripVerticalIcon, PlusIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { cn } from '@qualy/ui/cn'
import { Input } from '@qualy/ui/input'
import { Choice } from './Choice.tsx'
import { assessmentMessages as m } from '../i18n.ts'
import { lastDay } from '../entry/model.ts'

// The questions inside a question: what a participant is asked to type,
// pick or attach.
//
// One line per field, in the order they will be filled, showing only what
// tells them apart - name, type, whether it is required, what it will
// accept. A line opens onto its own settings, one at a time, because eight
// controls unfolded eight times is not a form anybody can read.

export interface FieldDraft {
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

/** the five columns a field line reads across, once there is room for them */
const COLUMNS = 'grid-cols-[1rem_minmax(0,1fr)_6.25rem_3.25rem_12.5rem_1.5rem] gap-3'
const COLUMNS_AT_SM =
  'sm:grid-cols-[1rem_minmax(0,1fr)_6.25rem_3.25rem_12.5rem_1.5rem] sm:gap-x-3 sm:gap-y-0'

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

  /** what this field will accept, in the words the column has room for */
  const limitOf = (field: FieldDraft): string => {
    if (field.type === 'date') {
      return format(m.itemsLimitDates, {
        from: field.min.trim() === '' ? materialRange.start : field.min,
        until: field.max.trim() === '' ? lastDay(materialRange.end) : field.max,
      })
    }
    if (field.type === 'attachment') {
      return format(m.itemsLimitFiles, { count: Number(field.maxCount) || 1 })
    }
    return field.maxLength.trim() === ''
      ? format(m.itemsLimitNone)
      : format(m.itemsLimitMaxLength, { count: Number(field.maxLength) })
  }

  return (
    <div className="flex flex-col">
      {/* the columns need the width; narrower than that a field is its name
          with what it accepts written underneath */}
      <div
        className={cn('hidden border-b px-0.5 pb-2 text-xs text-muted-foreground sm:grid', COLUMNS)}
      >
        <span />
        <span>{format(m.itemsFieldLabel)}</span>
        <span>{format(m.itemsFieldType)}</span>
        <span>{format(m.itemsFieldRequired)}</span>
        <span>{format(m.itemsFieldColLimit)}</span>
        <span />
      </div>

      {fields.length === 0 && (
        <p className="py-3 text-sm text-muted-foreground">{format(m.itemsFormEmpty)}</p>
      )}

      {fields.map((field) => {
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
                'grid grid-cols-[1rem_minmax(0,1fr)_1.5rem] items-center gap-x-3 gap-y-0.5 py-2',
                'sm:py-1.5',
                COLUMNS_AT_SM,
                marked === 'before' && 'shadow-[inset_0_2px_0_0_var(--primary)]',
                marked === 'after' && 'shadow-[inset_0_-2px_0_0_var(--primary)]',
              )}
            >
              <GripVerticalIcon
                aria-hidden
                className="size-3.5 cursor-grab text-muted-foreground/60"
              />
              <span className="min-w-0 truncate text-sm">
                {field.label.trim() === '' ? format(m.itemsFieldUnnamed) : field.label}
              </span>
              <span className="hidden text-sm sm:block">
                {format(FIELD_TYPE_LABEL[field.type])}
              </span>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {field.required ? format(m.itemsFieldRequired) : ''}
              </span>
              <span className="hidden truncate text-xs text-muted-foreground sm:block">
                {limitOf(field)}
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
            <Field label={format(m.itemsFieldAccept)} hint={format(m.itemsFieldAcceptHint)}>
              {(id) => (
                <Input
                  id={id}
                  className="bg-background"
                  value={field.accept}
                  placeholder=".pdf, image/*"
                  onChange={(event) => onChange({ accept: event.target.value })}
                />
              )}
            </Field>
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
