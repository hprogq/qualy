import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, GripVerticalIcon, PlusIcon, XIcon } from 'lucide-react'
import { useI18n, useList } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@qualy/ui/collapsible'
import { Input } from '@qualy/ui/input'
import { DatePicker } from '@qualy/ui/date-picker'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { acceptOf, FILE_KINDS, kindsOf, unwritableTokens } from '../../file-kinds.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { Choice } from '../Choice.tsx'
import { nextOptionKey, type FieldDraft, type FieldType, type OptionDraft } from './model.ts'
import { TYPE_LABEL } from './words.ts'

// The settings of one submission field, shared by the panel that edits a
// field and the dialog that adds one. A choice's options are edited by
// name alone: their values and identities are the system's, minted once
// and never shown.

const styles = stylex.create({
  group: { display: 'flex', flexDirection: 'column', gap: 12 },
  pair: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
  more: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 12.5,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  moreGlyph: {
    width: 12,
    height: 12,
    transitionProperty: 'transform',
    transitionDuration: '120ms',
  },
  moreGlyphOpen: { transform: 'rotate(90deg)' },
  moreBody: { paddingTop: 10 },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 },
  quiet: { fontSize: 12, color: tokens.mutedForeground },
  options: { display: 'flex', flexDirection: 'column', gap: 6 },
  optionsLabel: { fontSize: 12.5, color: tokens.foreground },
  optionRow: { display: 'flex', alignItems: 'center', gap: 8 },
  optionLifted: { opacity: 0.6 },
  optionMarkBefore: { boxShadow: `inset 0 2px 0 0 ${tokens.primary}` },
  optionMarkAfter: { boxShadow: `inset 0 -2px 0 0 ${tokens.primary}` },
  handle: {
    display: 'flex',
    flexShrink: 0,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
    cursor: { default: 'grab', ':active': 'grabbing' },
  },
  optionInput: { flexGrow: 1, minWidth: 0 },
  problem: { margin: 0, paddingLeft: 20, fontSize: 12, color: tokens.danger },
  addOption: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingLeft: 20,
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 500,
    color: tokens.foreground,
    backgroundColor: 'transparent',
    borderWidth: 0,
    cursor: 'pointer',
  },
  disabledBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 4,
    paddingInline: 12,
    paddingBlock: 10,
    borderRadius: 10,
    backgroundColor: tokens.surfaceInset,
  },
  disabledHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'inherit',
    fontSize: 12.5,
    color: tokens.foreground,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: 'pointer',
  },
  disabledRow: { display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 18, fontSize: 13 },
  disabledName: { color: tokens.mutedForeground },
  spacer: { flexGrow: 1 },
  restore: {
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 500,
    color: tokens.foreground,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: 'pointer',
  },
  icon12: { width: 12, height: 12 },
  icon13: { width: 13, height: 13 },
  // the file kinds
  kindGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 },
  kindButton: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 10,
    borderRadius: 10,
    textAlign: 'start',
    fontFamily: 'inherit',
    color: 'inherit',
    backgroundColor: tokens.background,
    borderWidth: 0,
    cursor: 'pointer',
  },
  kindOn: { boxShadow: `inset 0 0 0 2px ${tokens.foreground}` },
  kindOff: { boxShadow: `inset 0 0 0 1px ${tokens.border}` },
  kindHead: { display: 'flex', alignItems: 'center', gap: 8 },
  kindBox: {
    display: 'inline-flex',
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  kindBoxOn: { backgroundColor: tokens.foreground, color: tokens.background },
  kindBoxOff: { boxShadow: `inset 0 0 0 1px ${tokens.border}` },
  kindName: { fontSize: 13, fontWeight: 500 },
  kindTokens: { fontSize: 11, color: tokens.mutedForeground, overflowWrap: 'anywhere' },
  customBox: { display: 'flex', flexDirection: 'column', gap: 8 },
  resolvedRow: { display: 'flex', gap: 8, fontSize: 12, flexWrap: 'wrap' },
  resolvedLabel: { color: tokens.mutedForeground },
  resolvedValue: { overflowWrap: 'anywhere' },
  unwritable: { margin: 0, fontSize: 12, color: tokens.danger },
})

export function FieldSettingsForm({
  field,
  materialRange,
  storedOptionIds,
  withType = false,
  numberKind = false,
  requiredLocked = false,
  onChange,
  onRetype,
  onDisableOption,
}: {
  field: FieldDraft
  /** the round's own window; a date field can only narrow it */
  materialRange: { start: string; end: string }
  /**
   * The options a published question already carries: their removal is a
   * disabling, asked about first, rather than a deletion.
   */
  storedOptionIds: ReadonlySet<string>
  /** offer the type itself, for a field that already exists */
  withType?: boolean
  /** offer whole number against decimal, for a field being added as a number */
  numberKind?: boolean
  requiredLocked?: boolean
  onChange: (next: FieldDraft) => void
  /** a different type, which is a different field */
  onRetype?: (type: FieldType) => void
  onDisableOption?: (optionId: string) => void
}) {
  const { format } = useI18n()
  const patch = (next: Partial<FieldDraft>) => onChange({ ...field, ...next })
  return (
    <>
      <div {...stylex.props(styles.group)}>
        <Field label={format(m.itemsName)}>
          {(id) => (
            <Input
              id={id}
              value={field.label}
              maxLength={50}
              required
              aria-invalid={field.label.trim() === '' || undefined}
              onChange={(event) => patch({ label: event.target.value })}
            />
          )}
        </Field>
        <Field label={format(m.itemsFieldHint)}>
          {(id) => (
            <Input
              id={id}
              value={field.description}
              maxLength={200}
              placeholder={format(m.itemsFieldHintPlaceholder)}
              onChange={(event) => patch({ description: event.target.value })}
            />
          )}
        </Field>
        {withType && onRetype !== undefined && (
          <Field label={format(m.itemsFieldType)}>
            {(id) => (
              <Choice
                id={id}
                value={field.type}
                options={(['text', 'integer', 'decimal', 'date', 'choice', 'boolean', 'attachment'] as const).map(
                  (type) => ({ value: type, label: format(TYPE_LABEL[type]) }),
                )}
                onChange={(next) => onRetype(next as FieldType)}
              />
            )}
          </Field>
        )}
        {numberKind && onRetype !== undefined && (field.type === 'integer' || field.type === 'decimal') && (
          <Field label={format(m.itemsNumberKind)}>
            {(id) => (
              <Choice
                id={id}
                value={field.type}
                options={[
                  { value: 'integer', label: format(TYPE_LABEL.integer) },
                  { value: 'decimal', label: format(TYPE_LABEL.decimal) },
                ]}
                onChange={(next) => onRetype(next as FieldType)}
              />
            )}
          </Field>
        )}
      </div>

      <TypeSettings
        field={field}
        materialRange={materialRange}
        storedOptionIds={storedOptionIds}
        onChange={onChange}
        onDisableOption={onDisableOption}
      />

      <label {...stylex.props(styles.checkLabel)}>
        <Checkbox
          checked={field.required}
          disabled={requiredLocked}
          onCheckedChange={(next) => patch({ required: next === true })}
        />
        {format(m.itemsFieldRequired)}
      </label>
    </>
  )
}

function TypeSettings({
  field,
  materialRange,
  storedOptionIds,
  onChange,
  onDisableOption,
}: {
  field: FieldDraft
  materialRange: { start: string; end: string }
  storedOptionIds: ReadonlySet<string>
  onChange: (next: FieldDraft) => void
  onDisableOption?: ((optionId: string) => void) | undefined
}) {
  const { format, locale } = useI18n()
  const words = usePickerWords()
  // the pattern is the one setting most fields never need: folded until it
  // holds something, and remembered open once it has been looked at
  const [more, setMore] = useState(field.pattern.trim() !== '')
  const patch = (next: Partial<FieldDraft>) => onChange({ ...field, ...next })
  switch (field.type) {
    case 'text':
      return (
        <div {...stylex.props(styles.group)}>
          <div {...stylex.props(styles.pair)}>
            <Field label={format(m.itemsFieldMinLength)}>
              {(id) => (
                <Input id={id} inputMode="numeric" value={field.minLength} onChange={(event) => patch({ minLength: event.target.value })} />
              )}
            </Field>
            <Field label={format(m.itemsFieldMaxLength)}>
              {(id) => (
                <Input id={id} inputMode="numeric" value={field.maxLength} onChange={(event) => patch({ maxLength: event.target.value })} />
              )}
            </Field>
          </div>
          <Collapsible open={more} onOpenChange={setMore}>
            <CollapsibleTrigger {...stylex.props(styles.more)}>
              <ChevronRightIcon
                aria-hidden
                {...stylex.props(styles.moreGlyph, more && styles.moreGlyphOpen)}
              />
              {format(m.itemsFieldAdvanced)}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div {...stylex.props(styles.moreBody)}>
                <Field label={format(m.itemsFieldPattern)} hint={format(m.itemsFieldPatternHint)}>
                  {(id) => (
                    <Input
                      id={id}
                      value={field.pattern}
                      onChange={(event) => patch({ pattern: event.target.value })}
                    />
                  )}
                </Field>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )
    case 'integer':
    case 'decimal':
      return (
        <div {...stylex.props(styles.group)}>
          <div {...stylex.props(styles.pair)}>
            <Field label={format(m.itemsFieldMinValue)}>
              {(id) => (
                <Input
                  id={id}
                  inputMode={field.type === 'decimal' ? 'decimal' : 'numeric'}
                  value={field.min}
                  onChange={(event) => patch({ min: event.target.value })}
                />
              )}
            </Field>
            <Field label={format(m.itemsFieldMaxValue)}>
              {(id) => (
                <Input
                  id={id}
                  inputMode={field.type === 'decimal' ? 'decimal' : 'numeric'}
                  value={field.max}
                  onChange={(event) => patch({ max: event.target.value })}
                />
              )}
            </Field>
          </div>
          {field.type === 'decimal' && (
            <Field label={format(m.itemsFieldMaxScale)}>
              {(id) => (
                <Input id={id} inputMode="numeric" value={field.maxScale} onChange={(event) => patch({ maxScale: event.target.value })} />
              )}
            </Field>
          )}
        </div>
      )
    case 'date':
      return (
        <div {...stylex.props(styles.group)}>
          <div {...stylex.props(styles.pair)}>
            <Field label={format(m.itemsFieldMinDate)}>
              {(id) => (
                <DatePicker
                  id={id}
                  value={field.min === '' ? null : field.min}
                  min={materialRange.start}
                  max={materialRange.end}
                  clearLabel={words.clear}
                  localeTag={locale}
                  monthLabel={words.month}
                  yearLabel={words.year}
                  onChange={(next) => patch({ min: next ?? '' })}
                />
              )}
            </Field>
            <Field label={format(m.itemsFieldMaxDate)}>
              {(id) => (
                <DatePicker
                  id={id}
                  value={field.max === '' ? null : field.max}
                  min={materialRange.start}
                  max={materialRange.end}
                  clearLabel={words.clear}
                  localeTag={locale}
                  monthLabel={words.month}
                  yearLabel={words.year}
                  onChange={(next) => patch({ max: next ?? '' })}
                />
              )}
            </Field>
          </div>
          <p {...stylex.props(styles.quiet)}>
            {format(m.itemsDateWindow, { from: materialRange.start, until: materialRange.end })}
          </p>
        </div>
      )
    case 'choice':
      return (
        <OptionsEditor
          options={field.options}
          storedOptionIds={storedOptionIds}
          onChange={(options) => patch({ options })}
          onDisable={onDisableOption}
        />
      )
    case 'boolean':
      return null
    case 'attachment':
      return (
        <div {...stylex.props(styles.group)}>
          <div {...stylex.props(styles.pair)}>
            <Field label={format(m.itemsFieldMaxCount)}>
              {(id) => (
                <Input id={id} inputMode="numeric" value={field.maxCount} onChange={(event) => patch({ maxCount: event.target.value })} />
              )}
            </Field>
            <Field label={format(m.itemsFieldMaxSize)}>
              {(id) => (
                <Input id={id} inputMode="decimal" value={field.maxSizeMb} onChange={(event) => patch({ maxSizeMb: event.target.value })} />
              )}
            </Field>
          </div>
          <AcceptPicker accept={field.accept} onChange={(accept) => patch({ accept })} />
        </div>
      )
  }
}

/**
 * A choice's options: the live ones by name, in order, and the disabled
 * ones folded away underneath. Removing an option a published question
 * already carries is a disabling: records that chose it keep their word.
 */
export function OptionsEditor({
  options,
  storedOptionIds,
  onChange,
  onDisable,
}: {
  options: readonly OptionDraft[]
  storedOptionIds: ReadonlySet<string>
  onChange: (next: OptionDraft[]) => void
  onDisable?: ((optionId: string) => void) | undefined
}) {
  const { format } = useI18n()
  const [showDisabled, setShowDisabled] = useState(false)
  const [held, setHeld] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const live = options.filter((one) => one.enabled)
  const off = options.filter((one) => !one.enabled)
  const edgeOf = (event: React.DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY < box.top + box.height / 2 ? ('before' as const) : ('after' as const)
  }
  const move = (dragged: string, target: string, edge: 'before' | 'after') => {
    if (dragged === target) return
    const order = options.filter((one) => one.id !== dragged)
    const at = order.findIndex((one) => one.id === target)
    const moved = options.find((one) => one.id === dragged)
    if (moved === undefined) return
    order.splice(edge === 'before' ? at : at + 1, 0, moved)
    onChange(order)
  }
  const remove = (option: OptionDraft) => {
    if (storedOptionIds.has(option.id) && onDisable !== undefined) {
      onDisable(option.id)
      return
    }
    onChange(options.filter((one) => one.id !== option.id))
  }
  return (
    <div {...stylex.props(styles.options)} data-testid="options-editor">
      <span {...stylex.props(styles.optionsLabel)}>{format(m.itemsOptions)}</span>
      {live.map((option) => {
        const blank = option.label.trim() === ''
        return (
          <div key={option.id}>
            <div
              {...stylex.props(
                styles.optionRow,
                held === option.id && styles.optionLifted,
                drop?.id === option.id && (drop.edge === 'before' ? styles.optionMarkBefore : styles.optionMarkAfter),
              )}
              data-testid="option-row"
              data-option-id={option.id}
              draggable={held === option.id}
              onDragStart={(event) => {
                event.dataTransfer.setData('qualy/option', option.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                setHeld(null)
                setDrop(null)
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('qualy/option')) return
                event.preventDefault()
                setDrop({ id: option.id, edge: edgeOf(event) })
              }}
              onDragLeave={() => setDrop((mark) => (mark?.id === option.id ? null : mark))}
              onDrop={(event) => {
                event.preventDefault()
                setDrop(null)
                const dragged = event.dataTransfer.getData('qualy/option')
                if (dragged !== '') move(dragged, option.id, edgeOf(event))
              }}
            >
              <span
                aria-hidden
                {...stylex.props(styles.handle)}
                onPointerDown={() => setHeld(option.id)}
                onPointerUp={() => setHeld(null)}
              >
                <GripVerticalIcon {...stylex.props(styles.icon12)} />
              </span>
              <Input
                wrapperXstyle={styles.optionInput}
                value={option.label}
                placeholder={format(m.itemsOptionPlaceholder)}
                aria-label={format(m.itemsOptionPlaceholder)}
                aria-invalid={blank || undefined}
                onChange={(event) =>
                  onChange(options.map((one) => (one.id === option.id ? { ...one, label: event.target.value } : one)))
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => remove(option)}
                aria-label={format(
                  storedOptionIds.has(option.id) && onDisable !== undefined ? m.itemsOptionDisable : m.itemsOptionRemove,
                )}
              >
                <XIcon aria-hidden />
                <VisuallyHidden>{format(m.itemsOptionRemove)}</VisuallyHidden>
              </Button>
            </div>
            {blank && (
              <p {...stylex.props(styles.problem)} role="alert">
                {format(m.itemsOptionEmpty)}
              </p>
            )}
          </div>
        )
      })}
      <button
        type="button"
        {...stylex.props(styles.addOption)}
        onClick={() => onChange([...options, { id: nextOptionKey(), value: '', label: '', enabled: true }].map(valued))}
      >
        <PlusIcon aria-hidden {...stylex.props(styles.icon13)} />
        {format(m.itemsChoiceAdd)}
      </button>
      {off.length > 0 && (
        <div {...stylex.props(styles.disabledBox)} data-testid="disabled-options">
          <button
            type="button"
            {...stylex.props(styles.disabledHead)}
            aria-expanded={showDisabled}
            onClick={() => setShowDisabled((open) => !open)}
          >
            {showDisabled ? (
              <ChevronDownIcon aria-hidden {...stylex.props(styles.icon12)} />
            ) : (
              <ChevronRightIcon aria-hidden {...stylex.props(styles.icon12)} />
            )}
            {format(m.itemsDisabledOptions)} {off.length}
          </button>
          {showDisabled &&
            off.map((option) => (
              <div key={option.id} {...stylex.props(styles.disabledRow)} data-testid="disabled-option" data-option-id={option.id}>
                <span {...stylex.props(styles.disabledName)}>{option.label}</span>
                <span {...stylex.props(styles.spacer)} />
                <button
                  type="button"
                  {...stylex.props(styles.restore)}
                  onClick={() => onChange(options.map((one) => (one.id === option.id ? { ...one, enabled: true } : one)))}
                >
                  {format(m.itemsOptionRestore)}
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

/** an option's value is its identity until a formula lends it one */
const valued = (option: OptionDraft): OptionDraft =>
  option.value === '' ? { ...option, value: option.id } : option

function AcceptPicker({ accept, onChange }: { accept: string; onChange: (next: string) => void }) {
  const { format } = useI18n()
  const listJoin = useList()
  const stored = accept
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '')
  const { picked, rest } = kindsOf(stored)
  const [custom, setCustom] = useState(rest.join(', '))
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
    <div {...stylex.props(styles.group)}>
      <span {...stylex.props(styles.optionsLabel)}>{format(m.itemsFieldAccept)}</span>
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
                <span aria-hidden {...stylex.props(styles.kindBox, on ? styles.kindBoxOn : styles.kindBoxOff)}>
                  {on && <CheckIcon {...stylex.props(styles.icon12)} strokeWidth={3} />}
                </span>
                <span {...stylex.props(styles.kindName)}>{format(kind.name)}</span>
              </span>
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
              value={custom}
              placeholder="application/vnd.ms-outlook"
              onChange={(event) => {
                setCustom(event.target.value)
                write(picked, event.target.value, true)
              }}
            />
            <p {...stylex.props(styles.quiet)}>{format(m.itemsAcceptOtherHint)}</p>
            {unwritable.length > 0 && (
              <p {...stylex.props(styles.unwritable)}>
                {format(m.itemsAcceptUnwritable, { tokens: listJoin(unwritable) })}
              </p>
            )}
          </>
        )}
      </div>
      <div {...stylex.props(styles.resolvedRow)}>
        <span {...stylex.props(styles.resolvedLabel)}>{format(m.itemsAcceptResolved)}</span>
        <span {...stylex.props(styles.resolvedValue)}>
          {resolved.length === 0 ? format(m.itemsAcceptAny) : resolved.join(', ')}
        </span>
      </div>
    </div>
  )
}
