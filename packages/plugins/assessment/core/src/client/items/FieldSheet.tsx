import { useState } from 'react'
import { GripVerticalIcon, PencilIcon, PlusIcon, XIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { cn } from '@qualy/ui/cn'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { assessmentMessages as m } from '../i18n.ts'
import { lastDay } from '../entry/model.ts'

// The questions inside a question: what a participant is asked to type,
// pick or attach.
//
// The list is the shape of the form, one card per field in the order they
// will be filled; the settings of any one field are a panel away, because
// eight controls unfolded eight times is not a form anybody can read.

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

export const FIELD_TYPE_LABEL = {
  text: m.itemsTypeText,
  date: m.itemsTypeDate,
  attachment: m.itemsTypeAttachment,
} as const

/**
 * The list, reorderable by its handles.
 *
 * A dropped field lands where the line was drawn, and the order it lands in
 * is the order a participant meets the questions.
 */
export function FieldList({
  fields,
  onReorder,
  onEdit,
  onRemove,
  onAdd,
}: {
  fields: readonly FieldDraft[]
  onReorder: (orderedKeys: readonly string[]) => void
  onEdit: (key: string) => void
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

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">{format(m.itemsFormEmpty)}</p>
      )}
      {fields.map((field, index) => {
        const marked = drop?.key === field.key ? drop.edge : null
        return (
          <div
            key={field.key}
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
            className={cn(
              'flex items-center gap-2 rounded-lg border bg-card p-3',
              marked === 'before' && 'shadow-[0_-2px_0_0_var(--primary)]',
              marked === 'after' && 'shadow-[0_2px_0_0_var(--primary)]',
            )}
          >
            <GripVerticalIcon
              aria-hidden
              className="size-4 shrink-0 cursor-grab text-muted-foreground/60"
            />
            <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-sm hover:underline underline-offset-4"
              onClick={() => onEdit(field.key)}
            >
              {field.label.trim() === '' ? format(m.itemsFieldUnnamed) : field.label}
              {field.required && <span className="pl-0.5 text-destructive">*</span>}
            </button>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {format(FIELD_TYPE_LABEL[field.type])}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 shrink-0 p-0"
              aria-label={format(m.itemsFieldEdit)}
              onClick={() => onEdit(field.key)}
            >
              <PencilIcon aria-hidden className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 shrink-0 p-0"
              aria-label={format(m.itemsFieldRemove)}
              onClick={() => onRemove(field.key)}
            >
              <XIcon aria-hidden className="size-3.5" />
            </Button>
          </div>
        )
      })}
      <div className="pt-1">
        <Button variant="outline" size="sm" onClick={onAdd}>
          <PlusIcon aria-hidden className="size-3.5" />
          {format(m.itemsFieldAdd)}
        </Button>
      </div>
    </div>
  )
}

/** one field's settings, opened from its card */
export function FieldSheet({
  field,
  materialRange,
  onChange,
  onClose,
}: {
  field: FieldDraft
  /** the round's own window; a date field can only narrow it, never widen it */
  materialRange: { start: string; end: string }
  onChange: (next: Partial<FieldDraft>) => void
  onClose: () => void
}) {
  const { format } = useI18n()
  return (
    <SidePanel
      open
      title={format(m.itemsFieldSettings)}
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose}>{format(commonMessages.close)}</Button>
        </div>
      }
    >
      <Field label={format(m.itemsFieldLabel)}>
        {(id) => (
          <Input
            id={id}
            autoFocus
            value={field.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        )}
      </Field>
      <Field label={format(m.itemsFieldType)}>
        {(id) => (
          <NativeSelect
            id={id}
            value={field.type}
            onChange={(event) => onChange({ type: event.target.value as FieldDraft['type'] })}
          >
            <option value="text">{format(m.itemsTypeText)}</option>
            <option value="date">{format(m.itemsTypeDate)}</option>
            <option value="attachment">{format(m.itemsTypeAttachment)}</option>
          </NativeSelect>
        )}
      </Field>

      {field.type === 'text' && (
        <Field label={format(m.itemsFieldMaxLength)}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              value={field.maxLength}
              onChange={(event) => onChange({ maxLength: event.target.value })}
            />
          )}
        </Field>
      )}

      {field.type === 'date' && (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label={format(m.itemsFieldMinDate)}>
              {(id) => (
                <Input
                  id={id}
                  type="date"
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
                  value={field.max}
                  min={materialRange.start}
                  max={lastDay(materialRange.end)}
                  onChange={(event) => onChange({ max: event.target.value })}
                />
              )}
            </Field>
          </div>
          {/* the round decides the outer window; a bound outside it changes
              nothing, and silence about that is how a date the form seemed to
              accept came back refused */}
          <p className="text-xs text-muted-foreground">
            {format(m.itemsDateWindow, {
              from: materialRange.start,
              until: lastDay(materialRange.end),
            })}
          </p>
        </div>
      )}

      {field.type === 'attachment' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={format(m.itemsFieldMaxCount)}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
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
                  value={field.maxSizeMb}
                  onChange={(event) => onChange({ maxSizeMb: event.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label={format(m.itemsFieldAccept)} hint={format(m.itemsFieldAcceptHint)}>
            {(id) => (
              <Input
                id={id}
                value={field.accept}
                placeholder=".pdf, image/*"
                onChange={(event) => onChange({ accept: event.target.value })}
              />
            )}
          </Field>
        </>
      )}

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={field.required}
          onCheckedChange={(next) => onChange({ required: next === true })}
        />
        {format(m.itemsFieldRequired)}
      </label>
    </SidePanel>
  )
}
