import { FieldFill } from '../field-fill.ts'
import { useEffect, useId, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { breakpoints } from '../../theme/breakpoints.stylex.ts'
import { a11yStyles } from '../../lib/visually-hidden.tsx'
import { Checkbox } from '../checkbox.tsx'
import { EmptyField } from '../empty-field.tsx'
import {
  Field as FormField,
  FieldDescription as FormFieldDescription,
  FieldError as FormFieldError,
  FieldLabel as FormFieldLabel,
} from '../field.tsx'
import { RadioGroup as RadioGroupRoot, RadioGroupItem } from '../radio-group.tsx'

// a labelled control; the generated id ties label to input, which is what
// makes these screens reachable by name in a browser test and by a screen
// reader in real use

const styles = stylex.create({
  // the choices stack, and the plain ones pair up once there is room
  cardChoices: {
    display: 'grid',
    gap: 8,
  },
  plainChoices: {
    display: 'grid',
    gap: 4,
    gridTemplateColumns: {
      default: null,
      [breakpoints.tablet]: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  requiredMark: {
    paddingLeft: 2,
    color: tokens.danger,
  },
  // a label that carries a note takes the whole line, so the note can sit at
  // the far end of it rather than trailing the words
  labelRow: { width: '100%', flexWrap: 'wrap' },
  labelSpring: { minWidth: 6, flexGrow: 1 },
  // A note says what a field takes, and some fields take a lot - a list of
  // eight choices, a length and a pattern. Held rigid it drove the row past
  // the pane, put a scrollbar under the form and squeezed the label itself
  // into a column of single characters. So it gives way: it shrinks, breaks
  // where it must, and drops to its own line before any of that happens.
  labelNote: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: '0.6875rem',
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
    overflowWrap: 'anywhere',
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  legend: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  // a legend is not part of the flow box, so its spacing is its own
  legendSpaced: {
    marginBottom: 8,
  },
  // over a box standing in for the choices, the gap a field's label keeps
  // from its control; the rows of choices bring their own air
  legendOverBox: {
    marginBottom: 12,
  },
  optionGrid: {
    display: 'grid',
    gap: 4,
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.phone]: 'none',
    },
  },
  optionRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: tokens.radiusMd,
    paddingInline: 8,
    paddingBlock: 4,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  optionRowLive: {
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  optionRowDisabled: {
    opacity: 0.5,
  },
  controlNudge: {
    marginTop: 2,
  },
  optionText: {
    minWidth: 0,
  },
  optionLabel: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionHint: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  // a radio's hint wraps: the choice hangs on the difference between hints,
  // and an ellipsis would hide exactly the words that differ
  optionHintWrap: {
    display: 'block',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  // one choice as a bordered card: the row is one object - name, hint and
  // the radio that answers for it - and the tint says which one is chosen.
  // The admin layer knows the selected value, so the checked face is plain
  // state here, not a :has() dig through the DOM.
  card: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 16,
    fontSize: '0.875rem',
    lineHeight: 1.375,
    userSelect: 'none',
  },
  cardChecked: {
    borderColor: tokens.selectedBorder,
    backgroundColor: tokens.selectedSurface,
  },
  cardBody: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  cardTitle: {
    fontWeight: 500,
  },
  cardHint: {
    fontWeight: 400,
    lineHeight: 1.5,
    textAlign: 'left',
    color: tokens.mutedForeground,
  },
})

/**
 * The asterisk a required label wears.
 *
 * Exported because not every required control is a `Field`: a group of
 * toggles carries its own label row, and two hand-rolled asterisks drift
 * apart. Always aria-hidden - the accessible name is the label itself, and
 * "Title *" is what a screen reader would otherwise read out and a test
 * would have to ask for.
 */
export function RequiredMark() {
  return (
    <span aria-hidden {...stylex.props(styles.requiredMark)}>
      *
    </span>
  )
}

/**
 * What a field's control carries for whoever reads it aloud: that it must be
 * filled, that what it holds was refused, and where the words about it are.
 * Spread onto the control by the caller, which is the one that knows what
 * the control is.
 */
export interface FieldControl {
  readonly 'aria-required'?: true
  readonly 'aria-invalid'?: true
  readonly 'aria-describedby'?: string
}

export function Field({
  label,
  hint,
  error,
  required = false,
  aside,
  note,
  hideLabel = false,
  children,
}: {
  label: string
  /**
   * Keep the label spoken but not drawn.
   *
   * For a field whose caller already prints the same words - a section under
   * its own heading, say. The control still needs a name; what it does not
   * need is to say it twice.
   */
  hideLabel?: boolean
  hint?: ReactNode
  /** a small mark that rides the label's line after it, such as an identifier */
  aside?: ReactNode
  /** words at the far end of the label's line, such as what values it takes */
  note?: ReactNode
  /**
   * Marks the label with the usual asterisk. Hidden from the accessible
   * name, which is the label itself - a control called "Title *" is what a
   * screen reader would then have to read out, and what a test would have to
   * ask for.
   */
  required?: boolean
  /**
   * Why what the field holds was refused - a format it does not have, a
   * value somebody else already holds - said under the field it is about
   * rather than over the whole form. Only for what a reader can fix here;
   * what they cannot is the form's to say.
   */
  error?: ReactNode
  children: (id: string, control: FieldControl) => ReactNode
}) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const said = error !== undefined && error !== null && error !== false && error !== ''
  const describedBy = [said ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')
  const control: FieldControl = {
    ...(required ? { 'aria-required': true as const } : {}),
    ...(said ? { 'aria-invalid': true as const } : {}),
    ...(describedBy === '' ? {} : { 'aria-describedby': describedBy }),
  }
  return (
    <FormField>
      <FormFieldLabel
        htmlFor={id}
        {...(hideLabel
          ? { xstyle: a11yStyles.visuallyHidden }
          : note === undefined
            ? {}
            : { xstyle: styles.labelRow })}
      >
        {label}
        {required && <RequiredMark />}
        {aside}
        {note === undefined ? null : (
          <>
            <span {...stylex.props(styles.labelSpring)} />
            <span {...stylex.props(styles.labelNote)}>{note}</span>
          </>
        )}
      </FormFieldLabel>
      <FieldFill value>{children(id, control)}</FieldFill>
      {said && (
        <FormFieldError id={errorId} data-testid="field-error">
          {error}
        </FormFieldError>
      )}
      {hint && <FormFieldDescription id={hintId}>{hint}</FormFieldDescription>}
    </FormField>
  )
}

export interface CheckboxOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

// multi-select as real checkboxes rather than a custom widget: keyboard,
// labels and form semantics come free and are what a test drives
export function CheckboxGroup({
  legend,
  options,
  selected,
  onChange,
  disabled,
  emptyLabel,
  emptyHint,
  emptyAction,
  hideLegend = false,
  required = false,
}: {
  legend: string
  options: readonly CheckboxOption[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /** what the group says in place of its boxes when it has none */
  emptyLabel: string
  /** why there are none, and what to do about it */
  emptyHint?: ReactNode
  /** the way to where the choices are made */
  emptyAction?: ReactNode
  /**
   * Keep the legend spoken but not drawn.
   *
   * For a group whose caller already prints the same words - beside a
   * select-all, say, which cannot sit inside the fieldset's legend. A
   * fieldset still needs a name; what it does not need is to say it twice.
   */
  hideLegend?: boolean
  /** at least one must be ticked: the legend wears the mark a required field's label does */
  required?: boolean
}) {
  const chosen = new Set(selected)
  const toggle = (value: string) => {
    const next = new Set(chosen)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange([...next])
  }
  return (
    <fieldset {...stylex.props(styles.group)} disabled={disabled}>
      <legend
        {...stylex.props(
          hideLegend
            ? a11yStyles.visuallyHidden
            : [styles.legend, options.length === 0 && styles.legendOverBox],
        )}
      >
        {legend}
        {required && !hideLegend && <RequiredMark />}
      </legend>
      {options.length === 0 ? (
        <EmptyField
          title={emptyLabel}
          {...(emptyHint === undefined ? {} : { hint: emptyHint })}
          {...(emptyAction === undefined ? {} : { action: emptyAction })}
        />
      ) : (
        <div {...stylex.props(styles.optionGrid)}>
          {options.map((option) => {
            const off = (option.disabled ?? false) || (disabled ?? false)
            return (
              <label
                key={option.value}
                {...stylex.props(
                  styles.optionRow,
                  off ? styles.optionRowDisabled : styles.optionRowLive,
                )}
              >
                <Checkbox
                  className={stylex.props(styles.controlNudge).className}
                  checked={chosen.has(option.value)}
                  disabled={option.disabled ?? disabled}
                  onCheckedChange={() => toggle(option.value)}
                />
                <span {...stylex.props(styles.optionText)}>
                  <span {...stylex.props(styles.optionLabel)}>{option.label}</span>
                  {option.hint && <span {...stylex.props(styles.optionHint)}>{option.hint}</span>}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

// One-of-several as real radios, for the same reasons as the checkboxes
// above: a fieldset with a legend is what a screen reader announces and what
// a test drives by role and name.
export function RadioGroup({
  legend,
  name,
  options,
  selected,
  onChange,
  disabled,
  variant = 'list',
}: {
  legend: string
  name: string
  options: readonly CheckboxOption[]
  selected: string
  onChange: (next: string) => void
  disabled?: boolean
  /** 'cards' gives each option a full-width target, for a few real choices */
  variant?: 'list' | 'cards'
}) {
  if (variant === 'cards') {
    return (
      <fieldset {...stylex.props(styles.group)} disabled={disabled}>
        <legend {...stylex.props(styles.legend, styles.legendSpaced)}>{legend}</legend>
        <RadioGroupRoot
          name={name}
          value={selected}
          onValueChange={onChange}
          {...(disabled !== undefined ? { disabled } : {})}
          xstyle={styles.cardChoices}
        >
          {options.map((option) => {
            const on = selected === option.value
            return (
              <label
                key={option.value}
                data-picked={on}
                {...stylex.props(styles.card, on && styles.cardChecked)}
              >
                <span {...stylex.props(styles.cardBody)}>
                  <span {...stylex.props(styles.cardTitle)}>{option.label}</span>
                  {option.hint && <span {...stylex.props(styles.cardHint)}>{option.hint}</span>}
                </span>
                <RadioGroupItem value={option.value} disabled={option.disabled ?? disabled} />
              </label>
            )
          })}
        </RadioGroupRoot>
      </fieldset>
    )
  }
  return (
    <fieldset {...stylex.props(styles.group)} disabled={disabled}>
      <legend {...stylex.props(styles.legend)}>{legend}</legend>
      <RadioGroupRoot
        name={name}
        value={selected}
        onValueChange={onChange}
        {...(disabled !== undefined ? { disabled } : {})}
        xstyle={styles.plainChoices}
      >
        {options.map((option) => {
          const off = (option.disabled ?? false) || (disabled ?? false)
          return (
            <label
              key={option.value}
              {...stylex.props(
                styles.optionRow,
                off ? styles.optionRowDisabled : styles.optionRowLive,
              )}
            >
              <RadioGroupItem
                className={stylex.props(styles.controlNudge).className}
                value={option.value}
                disabled={option.disabled ?? disabled}
              />
              <span {...stylex.props(styles.optionText)}>
                <span {...stylex.props(styles.optionLabel)}>{option.label}</span>
                {option.hint && <span {...stylex.props(styles.optionHintWrap)}>{option.hint}</span>}
              </span>
            </label>
          )
        })}
      </RadioGroupRoot>
    </fieldset>
  )
}

/**
 * A check on what is being typed, said once the typing has settled: after a
 * pause, or on leaving the field - never at the first character, when every
 * address is still an invalid one. Nothing is said about an empty field;
 * whether one may be empty is the form's to decide.
 */
export function useSettledCheck(
  value: string,
  check: (value: string) => string | null,
  pause = 700,
): { readonly error: string | null; readonly onBlur: () => void } {
  const [settled, setSettled] = useState(value)
  const [left, setLeft] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), pause)
    return () => clearTimeout(timer)
  }, [value, pause])
  const judged = left ? value : settled
  return {
    error: judged.trim() === '' ? null : check(judged),
    onBlur: () => setLeft(true),
  }
}
