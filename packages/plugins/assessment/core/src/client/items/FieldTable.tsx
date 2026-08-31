import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronDownIcon, GripVerticalIcon, PlusIcon, XIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
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

interface FieldDraftBase {
  /**
   * What this field is called across revisions. Minted with the key and
   * never changed; a field written before identities existed carries its
   * key here, because that is what identified it then.
   */
  id: string
  key: string
  label: string
  required: boolean
}

/** one editable option of a choice field; both halves are the author's */
export interface ChoiceOptionDraft {
  value: string
  label: string
}

/**
 * One field as the editor holds it, split by kind: each type carries only
 * the settings that mean something for it, so a field never drags five
 * other kinds' blank strings around, and a missing branch in any consumer
 * is a compile error instead of a silent fall-through.
 */
export type FieldDraft = FieldDraftBase &
  (
    | { type: 'text'; maxLength: string }
    | { type: 'date'; min: string; max: string }
    | { type: 'integer'; min: string; max: string }
    | { type: 'decimal'; maxScale: string; min: string; max: string }
    | { type: 'choice'; options: ChoiceOptionDraft[] }
    | { type: 'attachment'; maxCount: string; maxSizeMb: string; accept: string }
  )

/** the same field wearing another type: identity kept, settings reset */
const retypeDraft = (field: FieldDraft, type: FieldDraft['type']): FieldDraft => {
  const base = { id: field.id, key: field.key, label: field.label, required: field.required }
  switch (type) {
    case 'text':
      return { ...base, type, maxLength: '' }
    case 'date':
      return { ...base, type, min: '', max: '' }
    case 'integer':
      return { ...base, type, min: '', max: '' }
    case 'decimal':
      return { ...base, type, maxScale: '2', min: '', max: '' }
    case 'choice':
      return { ...base, type, options: [{ value: '', label: '' }] }
    case 'attachment':
      return { ...base, type, maxCount: '1', maxSizeMb: '', accept: '' }
  }
}

const sm = '@media (min-width: 640px)'

const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
  },
  listHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 10,
    rowGap: 4,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingBottom: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  divider: {
    height: 12,
    width: 1,
    backgroundColor: tokens.border,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  emptyNote: {
    paddingBlock: 12,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  /**
   * The columns a field line reads across, once there is room for them.
   *
   * Four rather than five: what used to be the "required" column is now a mark
   * beside the name, because a column whose every cell reads the same word is
   * a column that costs width and says nothing.
   */
  row: {
    cursor: 'pointer',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: `color-mix(in oklab, ${tokens.border} 60%, transparent)`,
    paddingInline: 2,
    transitionProperty: 'color, background-color, border-color',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 30%, transparent)`,
    },
    display: 'grid',
    gridTemplateColumns: {
      default: '2.25rem minmax(0, 1fr) 1.5rem',
      [sm]: '2.25rem minmax(0, 1fr) 6.25rem 12.5rem 1.5rem',
    },
    alignItems: 'center',
    columnGap: 12,
    rowGap: {
      default: 2,
      [sm]: 0,
    },
    paddingBlock: {
      default: 8,
      [sm]: 6,
    },
  },
  markBefore: {
    boxShadow: `inset 0 2px 0 0 ${tokens.primary}`,
  },
  markAfter: {
    boxShadow: `inset 0 -2px 0 0 ${tokens.primary}`,
  },
  handleCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  grip: {
    width: 14,
    height: 14,
    cursor: 'grab',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  ordinal: {
    width: 12,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  nameCell: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  nameText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  requiredDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.danger,
  },
  typeCell: {
    display: {
      default: 'none',
      [sm]: 'block',
    },
    fontSize: 14,
  },
  limitCell: {
    display: {
      default: 'none',
      [sm]: 'block',
    },
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  limitNone: {
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  chevron: {
    width: 14,
    height: 14,
    justifySelf: 'end',
    color: tokens.mutedForeground,
    transitionProperty: 'transform',
  },
  chevronOpen: {
    transform: 'rotate(180deg)',
  },
  narrowFacts: {
    gridColumnStart: 2,
    fontSize: 12,
    color: tokens.mutedForeground,
    display: {
      default: null,
      [sm]: 'none',
    },
  },
  addSeat: {
    paddingTop: 8,
  },
  addButton: {
    marginLeft: -8,
  },
  ghost: {
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  },
  settings: {
    display: 'grid',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: `color-mix(in oklab, ${tokens.border} 60%, transparent)`,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 12,
    paddingBlock: 14,
    gridTemplateColumns: {
      default: null,
      [sm]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  onBackground: {
    backgroundColor: tokens.background,
  },
  optionsBox: { display: 'flex', flexDirection: 'column', gap: 8 },
  optionsHead: { margin: 0, fontSize: 12, color: 'var(--q-surface-muted-foreground)' },
  optionRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr auto',
    gap: 8,
    alignItems: 'center',
  },
  span2: {
    gridColumn: {
      default: null,
      [sm]: 'span 2 / span 2',
    },
  },
  dateNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  settingsFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
  },
  dangerText: {
    color: tokens.danger,
  },
  picker: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  pickerTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  kindGrid: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: {
      default: null,
      [sm]: 'repeat(3, minmax(0, 1fr))',
    },
  },
  kindButton: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 10,
    textAlign: 'left',
    transitionProperty: 'color, background-color, border-color',
  },
  kindOn: {
    borderColor: tokens.foreground,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
  },
  kindOff: {
    backgroundColor: {
      default: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    },
  },
  kindHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  kindBox: {
    display: 'flex',
    width: 14,
    height: 14,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: 'solid',
  },
  kindBoxOn: {
    borderColor: tokens.foreground,
    backgroundColor: tokens.foreground,
    color: tokens.background,
  },
  kindBoxOff: {
    borderColor: tokens.input,
  },
  checkGlyph: {
    width: 10,
    height: 10,
  },
  kindName: {
    fontSize: 14,
  },
  kindTokens: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: MONO,
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  customBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    padding: 12,
  },
  customInput: {
    fontFamily: MONO,
    fontSize: 12,
  },
  customHint: {
    fontSize: 12,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  unwritableNote: {
    fontSize: 12,
    color: tokens.danger,
  },
  resolvedRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 12,
    paddingBlock: 8,
  },
  resolvedLabel: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  resolvedValue: {
    minWidth: 0,
    fontFamily: MONO,
    fontSize: 12,
  },
})

// a module that exports anything but components cannot be hot-replaced, and
// nothing outside this file needs it
/**
 * The row's own picture, carried under the pointer.
 *
 * The editor animates in a transformed panel, and a drag image taken from
 * inside one is snapshotted off that whole layer - the browser hands back
 * a picture of the screen instead of the row. A copy parked on the body
 * has no transformed ancestor, so what lifts is the row and nothing else.
 */
const liftGhost = (event: React.DragEvent<HTMLElement>) => {
  const row = event.currentTarget
  const box = row.getBoundingClientRect()
  const ghost = row.cloneNode(true) as HTMLElement
  ghost.style.position = 'fixed'
  ghost.style.top = '-1000px'
  ghost.style.left = '-1000px'
  ghost.style.width = `${String(box.width)}px`
  ghost.style.pointerEvents = 'none'
  const ghostClass = stylex.props(styles.ghost).className
  if (ghostClass !== undefined && ghostClass !== '') ghost.classList.add(...ghostClass.split(' '))
  document.body.append(ghost)
  event.dataTransfer.setDragImage(ghost, event.clientX - box.left, box.height / 2)
  // the browser has taken its picture by the next frame
  requestAnimationFrame(() => ghost.remove())
}

const FIELD_TYPE_LABEL = {
  text: m.itemsTypeText,
  date: m.itemsTypeDate,
  integer: m.itemsTypeInteger,
  decimal: m.itemsTypeDecimal,
  choice: m.itemsTypeChoice,
  attachment: m.itemsTypeAttachment,
} as const

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
  onChange: (key: string, next: FieldDraft) => void
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
    switch (field.type) {
      case 'date': {
        const from = field.min.trim()
        const until = field.max.trim()
        if (from === '' && until === '') return ''
        return format(m.itemsLimitDates, {
          from: from === '' ? materialRange.start : from,
          until: until === '' ? lastDay(materialRange.end) : until,
        })
      }
      case 'attachment':
        return format(m.itemsLimitFiles, { count: Number(field.maxCount) || 1 })
      case 'text':
        return field.maxLength.trim() === ''
          ? ''
          : format(m.itemsLimitMaxLength, { count: Number(field.maxLength) })
      case 'integer':
      case 'decimal': {
        const from = field.min.trim()
        const until = field.max.trim()
        if (from === '' && until === '') return ''
        return format(m.itemsLimitRange, {
          from: from === '' ? '−∞' : from,
          until: until === '' ? '+∞' : until,
        })
      }
      case 'choice':
        return format(m.itemsLimitChoices, { count: field.options.length })
    }
  }

  return (
    <div {...stylex.props(styles.root)}>
      {/* What the header row used to be. Column names over rows this short
          were four labels explaining four words; what is worth saying above
          the list is how much of it there is, and that a row opens. */}
      <div {...stylex.props(styles.listHeader)}>
        <span>{format(m.itemsFieldCount, { count: fields.length })}</span>
        {required > 0 && (
          <>
            <span aria-hidden {...stylex.props(styles.divider)} />
            <span>{format(m.itemsRequiredCount, { count: required })}</span>
          </>
        )}
        <span {...stylex.props(styles.spacer)} />
        {fields.length > 0 && <span>{format(m.itemsFieldOpenHint)}</span>}
      </div>

      {fields.length === 0 && <p {...stylex.props(styles.emptyNote)}>{format(m.itemsFormEmpty)}</p>}

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
                liftGhost(event)
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
              {...stylex.props(
                styles.row,
                marked === 'before' && styles.markBefore,
                marked === 'after' && styles.markAfter,
              )}
            >
              <span {...stylex.props(styles.handleCell)}>
                <GripVerticalIcon aria-hidden className={stylex.props(styles.grip).className} />
                {/* the order is the thing "fill these in in this order"
                    refers to, and it was the one fact the row never showed */}
                <span {...stylex.props(styles.ordinal)}>{index + 1}</span>
              </span>
              <span {...stylex.props(styles.nameCell)}>
                <span {...stylex.props(styles.nameText)}>
                  {field.label.trim() === '' ? format(m.itemsFieldUnnamed) : field.label}
                </span>
                {/* required as a mark on the name rather than a column of its
                    own: it is a fact about this field, and a column of the
                    same word repeated said nothing */}
                {field.required && (
                  <>
                    <span aria-hidden {...stylex.props(styles.requiredDot)} />
                    <VisuallyHidden>{format(m.itemsFieldRequired)}</VisuallyHidden>
                  </>
                )}
              </span>
              <span {...stylex.props(styles.typeCell)}>{format(FIELD_TYPE_LABEL[field.type])}</span>
              <span {...stylex.props(styles.limitCell)}>
                {limitOf(field) === '' ? (
                  <span {...stylex.props(styles.limitNone)}>—</span>
                ) : (
                  limitOf(field)
                )}
              </span>
              <ChevronDownIcon
                aria-hidden
                className={stylex.props(styles.chevron, open && styles.chevronOpen).className}
              />
              {/* what the columns would have said, on its own line */}
              <span {...stylex.props(styles.narrowFacts)}>
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

      <div {...stylex.props(styles.addSeat)}>
        <Button
          variant="ghost"
          size="sm"
          className={stylex.props(styles.addButton).className}
          onClick={onAdd}
        >
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
  onChange: (next: FieldDraft) => void
  onRemove: () => void
}) {
  const { format } = useI18n()
  return (
    <div {...stylex.props(styles.settings)}>
      <Field label={format(m.itemsFieldLabel)}>
        {(id) => (
          <Input
            id={id}
            autoFocus
            className={stylex.props(styles.onBackground).className}
            value={field.label}
            onChange={(event) => onChange({ ...field, label: event.target.value })}
          />
        )}
      </Field>
      <Field label={format(m.itemsFieldType)}>
        {(id) => (
          <Choice
            id={id}
            xstyle={styles.onBackground}
            value={field.type}
            options={[
              { value: 'text', label: format(m.itemsTypeText) },
              { value: 'integer', label: format(m.itemsTypeInteger) },
              { value: 'decimal', label: format(m.itemsTypeDecimal) },
              { value: 'choice', label: format(m.itemsTypeChoice) },
              { value: 'date', label: format(m.itemsTypeDate) },
              { value: 'attachment', label: format(m.itemsTypeAttachment) },
            ]}
            onChange={(next) => onChange(retypeDraft(field, next as FieldDraft['type']))}
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
              className={stylex.props(styles.onBackground).className}
              value={field.maxLength}
              onChange={(event) => onChange({ ...field, maxLength: event.target.value })}
            />
          )}
        </Field>
      )}

      {field.type === 'integer' && (
        <>
          <Field label={format(m.itemsFieldMinValue)}>
            {(id) => (
              <Input
                id={id}
                type="number"
                className={stylex.props(styles.onBackground).className}
                value={field.min}
                onChange={(event) => onChange({ ...field, min: event.target.value })}
              />
            )}
          </Field>
          <Field label={format(m.itemsFieldMaxValue)}>
            {(id) => (
              <Input
                id={id}
                type="number"
                className={stylex.props(styles.onBackground).className}
                value={field.max}
                onChange={(event) => onChange({ ...field, max: event.target.value })}
              />
            )}
          </Field>
        </>
      )}

      {field.type === 'decimal' && (
        <>
          <Field label={format(m.itemsFieldMaxScale)}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                max={18}
                className={stylex.props(styles.onBackground).className}
                value={field.maxScale}
                onChange={(event) => onChange({ ...field, maxScale: event.target.value })}
              />
            )}
          </Field>
          <Field label={format(m.itemsFieldMinValue)}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className={stylex.props(styles.onBackground).className}
                value={field.min}
                onChange={(event) => onChange({ ...field, min: event.target.value })}
              />
            )}
          </Field>
          <Field label={format(m.itemsFieldMaxValue)}>
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                className={stylex.props(styles.onBackground).className}
                value={field.max}
                onChange={(event) => onChange({ ...field, max: event.target.value })}
              />
            )}
          </Field>
        </>
      )}

      {field.type === 'choice' && (
        <div {...stylex.props(styles.span2)}>
          <OptionsEditor
            options={field.options}
            onChange={(options) => onChange({ ...field, options })}
          />
        </div>
      )}

      {field.type === 'date' && (
        <>
          <Field label={format(m.itemsFieldMinDate)}>
            {(id) => (
              <Input
                id={id}
                type="date"
                className={stylex.props(styles.onBackground).className}
                value={field.min}
                min={materialRange.start}
                max={lastDay(materialRange.end)}
                onChange={(event) => onChange({ ...field, min: event.target.value })}
              />
            )}
          </Field>
          <Field label={format(m.itemsFieldMaxDate)}>
            {(id) => (
              <Input
                id={id}
                type="date"
                className={stylex.props(styles.onBackground).className}
                value={field.max}
                min={materialRange.start}
                max={lastDay(materialRange.end)}
                onChange={(event) => onChange({ ...field, max: event.target.value })}
              />
            )}
          </Field>
          {/* the round decides the outer window; a bound outside it changes
              nothing, and silence about that is how a date the form seemed to
              accept came back refused */}
          <p {...stylex.props(styles.dateNote, styles.span2)}>
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
                className={stylex.props(styles.onBackground).className}
                value={field.maxCount}
                onChange={(event) => onChange({ ...field, maxCount: event.target.value })}
              />
            )}
          </Field>
          <Field label={format(m.itemsFieldMaxSize)}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                className={stylex.props(styles.onBackground).className}
                value={field.maxSizeMb}
                onChange={(event) => onChange({ ...field, maxSizeMb: event.target.value })}
              />
            )}
          </Field>
          <div {...stylex.props(styles.span2)}>
            <AcceptPicker
              accept={field.accept}
              onChange={(accept) => onChange({ ...field, accept })}
            />
          </div>
        </>
      )}

      <div {...stylex.props(styles.settingsFooter, styles.span2)}>
        <label {...stylex.props(styles.checkLabel)}>
          <Checkbox
            checked={field.required}
            onCheckedChange={(next) => onChange({ ...field, required: next === true })}
          />
          {format(m.itemsFieldRequired)}
        </label>
        <Button
          variant="ghost"
          size="sm"
          className={stylex.props(styles.dangerText).className}
          onClick={onRemove}
        >
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
/**
 * A choice field's options: the stable value payloads will carry, and the
 * words people see. Values are the identity - renaming a label rewords the
 * screen, editing a value redefines the answer - which is why both columns
 * are shown instead of deriving one from the other.
 */
function OptionsEditor({
  options,
  onChange,
}: {
  options: ChoiceOptionDraft[]
  onChange: (next: ChoiceOptionDraft[]) => void
}) {
  const { format } = useI18n()
  return (
    <div {...stylex.props(styles.optionsBox)} data-testid="choice-options">
      <p {...stylex.props(styles.optionsHead)}>{format(m.itemsChoiceOptions)}</p>
      {options.map((option, index) => (
        // options have no identity of their own; position is the row
        // eslint-disable-next-line react/no-array-index-key
        <div key={index} {...stylex.props(styles.optionRow)}>
          <Input
            aria-label={format(m.itemsChoiceValue)}
            placeholder={format(m.itemsChoiceValue)}
            className={stylex.props(styles.onBackground).className}
            value={option.value}
            onChange={(event) =>
              onChange(
                options.map((one, at) =>
                  at === index ? { ...one, value: event.target.value } : one,
                ),
              )
            }
          />
          <Input
            aria-label={format(m.itemsChoiceLabel)}
            placeholder={format(m.itemsChoiceLabel)}
            className={stylex.props(styles.onBackground).className}
            value={option.label}
            onChange={(event) =>
              onChange(
                options.map((one, at) =>
                  at === index ? { ...one, label: event.target.value } : one,
                ),
              )
            }
          />
          <Button
            variant="ghost"
            size="sm"
            aria-label={format(m.itemsChoiceRemove)}
            disabled={options.length <= 1}
            onClick={() => onChange(options.filter((_, at) => at !== index))}
          >
            <XIcon aria-hidden size={14} />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...options, { value: '', label: '' }])}
      >
        {format(m.itemsChoiceAdd)}
      </Button>
    </div>
  )
}

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
    <div {...stylex.props(styles.picker)}>
      <p {...stylex.props(styles.pickerTitle)}>{format(m.itemsFieldAccept)}</p>
      <div {...stylex.props(styles.kindGrid)}>
        {FILE_KINDS.map((kind) => {
          const on = picked.includes(kind.id)
          return (
            <button
              key={kind.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(kind.id)}
              {...stylex.props(styles.kindButton, on ? styles.kindOn : styles.kindOff)}
            >
              <span {...stylex.props(styles.kindHead)}>
                <span
                  aria-hidden
                  {...stylex.props(styles.kindBox, on ? styles.kindBoxOn : styles.kindBoxOff)}
                >
                  {on && <CheckIcon className={stylex.props(styles.checkGlyph).className} />}
                </span>
                <span {...stylex.props(styles.kindName)}>{format(kind.name)}</span>
              </span>
              {/* the notation it stands for, so the custom box below has a
                  worked example above it */}
              <span {...stylex.props(styles.kindTokens)}>{kind.tokens.join(', ')}</span>
            </button>
          )
        })}
      </div>

      <div {...stylex.props(styles.customBox)}>
        <label {...stylex.props(styles.checkLabel)}>
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
              className={stylex.props(styles.customInput).className}
              value={custom}
              placeholder="application/vnd.ms-outlook"
              onChange={(event) => {
                setCustom(event.target.value)
                write(picked, event.target.value, true)
              }}
            />
            <p {...stylex.props(styles.customHint)}>{format(m.itemsAcceptOtherHint)}</p>
            {unwritable.length > 0 && (
              <p {...stylex.props(styles.unwritableNote)}>
                {format(m.itemsAcceptUnwritable, { tokens: unwritable.join('、') })}
              </p>
            )}
          </>
        )}
      </div>

      {/* what the two halves add up to, which is the only thing stored */}
      <div {...stylex.props(styles.resolvedRow)}>
        <span {...stylex.props(styles.resolvedLabel)}>{format(m.itemsAcceptResolved)}</span>
        <span {...stylex.props(styles.resolvedValue)}>
          {resolved.length === 0 ? format(m.itemsAcceptAny) : resolved.join(', ')}
        </span>
      </div>
    </div>
  )
}
