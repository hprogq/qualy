import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { Checkbox } from '../checkbox.tsx'
import {
  Field as FormField,
  FieldContent as FormFieldContent,
  FieldDescription as FormFieldDescription,
  FieldLabel as FormFieldLabel,
  FieldTitle as FormFieldTitle,
} from '../field.tsx'
import { RadioGroup as RadioGroupRoot, RadioGroupItem } from '../radio-group.tsx'

// a labelled control; the generated id ties label to input, which is what
// makes these screens reachable by name in a browser test and by a screen
// reader in real use
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
    <span aria-hidden className="pl-0.5 text-destructive">
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
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1 text-sm',
                option.disabled || disabled ? 'opacity-50' : 'hover:bg-muted/50',
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={chosen.has(option.value)}
                disabled={option.disabled ?? disabled}
                onCheckedChange={() => toggle(option.value)}
              />
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {option.hint && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </span>
            </label>
          ))}
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
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        {/* a legend is not part of the flow box, so its spacing is its own */}
        <legend className="mb-2 text-sm font-medium">{legend}</legend>
        <RadioGroupRoot
          name={name}
          value={selected}
          onValueChange={onChange}
          {...(disabled !== undefined ? { disabled } : {})}
          className="grid gap-2"
        >
          {options.map((option) => (
            <FormFieldLabel key={option.value}>
              {/* a card is one choice, not a paragraph with a control beside
                  it: the same has- modifier the variant uses, so this wins */}
              <FormField
                orientation="horizontal"
                className="has-[>[data-slot=field-content]]:items-center"
              >
                <FormFieldContent>
                  <FormFieldTitle>{option.label}</FormFieldTitle>
                  {option.hint && <FormFieldDescription>{option.hint}</FormFieldDescription>}
                </FormFieldContent>
                <RadioGroupItem value={option.value} disabled={option.disabled ?? disabled} />
              </FormField>
            </FormFieldLabel>
          ))}
        </RadioGroupRoot>
      </fieldset>
    )
  }
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <RadioGroupRoot
        name={name}
        value={selected}
        onValueChange={onChange}
        {...(disabled !== undefined ? { disabled } : {})}
        className="grid gap-1 sm:grid-cols-2"
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex items-start gap-2 rounded-md px-2 py-1 text-sm',
              option.disabled || disabled ? 'opacity-50' : 'hover:bg-muted/50',
            )}
          >
            <RadioGroupItem
              className="mt-0.5"
              value={option.value}
              disabled={option.disabled ?? disabled}
            />
            <span className="min-w-0">
              <span className="block truncate">{option.label}</span>
              {option.hint && (
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              )}
            </span>
          </label>
        ))}
      </RadioGroupRoot>
    </fieldset>
  )
}
