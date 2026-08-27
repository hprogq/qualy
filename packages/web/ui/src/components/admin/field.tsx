import { useId, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { Checkbox } from '../checkbox.tsx'
import {
  Field as FormField,
  FieldDescription as FormFieldDescription,
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
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
    },
  },
  requiredMark: {
    paddingLeft: 2,
    color: tokens.danger,
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
  emptyNote: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  optionGrid: {
    display: 'grid',
    gap: 4,
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
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

export function Field({
  label,
  hint,
  required = false,
  children,
}: {
  label: string
  hint?: ReactNode
  /**
   * Marks the label with the usual asterisk. Hidden from the accessible
   * name, which is the label itself - a control called "Title *" is what a
   * screen reader would then have to read out, and what a test would have to
   * ask for.
   */
  required?: boolean
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <FormField>
      <FormFieldLabel htmlFor={id}>
        {label}
        {required && <RequiredMark />}
      </FormFieldLabel>
      {children(id)}
      {hint && <FormFieldDescription>{hint}</FormFieldDescription>}
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
}: {
  legend: string
  options: readonly CheckboxOption[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  emptyLabel: string
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
      <legend {...stylex.props(styles.legend)}>{legend}</legend>
      {options.length === 0 ? (
        <p {...stylex.props(styles.emptyNote)}>{emptyLabel}</p>
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
