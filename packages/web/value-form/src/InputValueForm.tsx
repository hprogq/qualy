/**
 * A form generated from a value-schema input contract: one field per
 * parameter in the authored order, labeled by the annotation layer with
 * the locale/default/key fallback, each control matched to the atomic
 * kind. State is the caller's (drafts in, changes out) and so are the
 * words for problems - this module renders structure, not copy.
 */

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  choiceLabel,
  declaredTitle,
  displayDescription,
  displayTitle,
  kindOf,
  type AtomicSchema,
  type ChoiceSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { DatePicker } from '@qualy/ui/date-picker'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Checkbox } from '@qualy/ui/checkbox'
import { Field } from '@qualy/ui/admin'
import { checkField, fieldsOfInput, type FieldDraft, type ValueFieldSpec } from './model.ts'

const styles = stylex.create({
  pair: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    height: 34,
    overflow: 'hidden',
    borderRadius: 8,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  pairOne: {
    display: 'inline-flex',
    minWidth: '3.5rem',
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: 14,
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 13,
    color: tokens.mutedForeground,
    cursor: 'pointer',
  },
  pairOn: {
    backgroundColor: { default: tokens.foreground, ':hover': tokens.foreground },
    color: tokens.background,
    fontWeight: 500,
  },
  grid: { display: 'flex', flexDirection: 'column', gap: '0.625rem' },
  key: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 18,
    paddingInline: 5,
    borderRadius: 4,
    backgroundColor: 'var(--q-surface-muted)',
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: '0.6875rem',
    fontWeight: 400,
    color: 'var(--q-surface-muted-foreground)',
  },
  description: {
    marginBlock: '0.4rem 0',
    fontSize: '0.75rem',
    color: 'var(--q-surface-muted-foreground)',
  },
  problem: { fontSize: '0.75rem', color: 'var(--q-danger, #b91c1c)', margin: 0 },
  control: { width: '100%' },
})

/**
 * The handful of words the controls need.
 *
 * This package renders structure, not copy, and a picker still has to say
 * something while it is unanswered and name the press that empties it. So
 * the caller brings the words, the same way it brings the drafts.
 */
export interface ValueFieldWords {
  /** what a choice or a date says while nothing is chosen */
  readonly unanswered: string
  /** the press that puts a field back to unanswered */
  readonly clear: string
  /** the calendar's caption pickers, read out but never shown */
  readonly month: string
  readonly year: string
  /**
   * The two answers to a yes-or-no field. Given, the field is two blocks side
   * by side with neither pressed until somebody presses one; not given, it is
   * the platform's three-state box. Somebody deciding a claim reads "neither
   * pressed" as unanswered at a glance, and reads a box wearing a dash as a
   * thing they do not recognise.
   */
  readonly yes?: string
  readonly no?: string
}

/**
 * Turning a field's reason code into the words under its box.
 *
 * Given, the form checks each field as it is typed and says what is wrong
 * without waiting for a run. The check is the package's; the words are the
 * screen's, because the same code reads differently under a parameter and
 * under a participant's claim.
 */
export type ExplainFieldProblem = (
  schema: AtomicSchema,
  id: string,
  reason: string,
) => string | undefined

/** long enough that a half-typed number is not called wrong mid-keystroke */
const SETTLE_MS = 400

export interface ValueFieldsFormProps {
  /** opaque field ids with their schemas, in display order */
  readonly fields: readonly ValueFieldSpec[]
  readonly drafts: Readonly<Record<string, FieldDraft>>
  readonly onDraft: (id: string, draft: FieldDraft) => void
  readonly locale: string
  readonly disabled?: boolean
  /** field id -> already-translated words about what stops it */
  readonly problems?: ReadonlyMap<string, string>
  /** distinguishes multiple forms on one screen for stable test hooks */
  readonly scope: string
  /** see {@link ValueFieldWords} */
  readonly words: ValueFieldWords
  /** see {@link ExplainFieldProblem} */
  readonly explain?: ExplainFieldProblem
  /** see {@link FieldAuthoring} */
  readonly authoring?: FieldAuthoring
  /** a small mark for one field's label line, by the field's id */
  readonly asideOf?: (id: string) => ReactNode
}

/**
 * The form as its contract's author sees it: every field wears the key the
 * code names it by, and a field the code gave no title says so in the words
 * given here instead of borrowing the key as its title.
 */
export interface FieldAuthoring {
  readonly unnamedLabel: string
  /** what values a field takes, in the caller's words */
  readonly noteOf?: (schema: AtomicSchema, name: string) => string | undefined
  /** where that note sits: at the end of the label's line, or under the control */
  readonly notePlacement?: 'label' | 'below'
}

export interface InputValueFormProps {
  readonly schema: NormalizedInputSchema
  readonly drafts: Readonly<Record<string, FieldDraft>>
  readonly onDraft: (name: string, draft: FieldDraft) => void
  readonly locale: string
  readonly disabled?: boolean
  /** field name -> already-translated words about what stops it */
  readonly problems?: ReadonlyMap<string, string>
  /** distinguishes multiple forms on one screen for stable test hooks */
  readonly scope: string
  /** see {@link ValueFieldWords} */
  readonly words: ValueFieldWords
  /** see {@link ExplainFieldProblem} */
  readonly explain?: ExplainFieldProblem
  /** see {@link FieldAuthoring} */
  readonly authoring?: FieldAuthoring
}

const AtomicControl = ({
  schema,
  draft,
  onDraft,
  locale,
  disabled,
  id,
  words,
}: {
  schema: AtomicSchema
  name: string
  draft: FieldDraft | undefined
  onDraft: (draft: FieldDraft) => void
  locale: string
  disabled: boolean
  id: string
  words: ValueFieldWords
}) => {
  const kind = kindOf(schema)
  if (kind === 'boolean' && words.yes !== undefined && words.no !== undefined) {
    const answers = [
      { value: true, label: words.yes },
      { value: false, label: words.no },
    ] as const
    return (
      // unanswered is neither pressed, so a field nobody reached is never
      // quietly reported as "no"
      <span
        role="radiogroup"
        id={id}
        data-answered={draft !== undefined}
        {...stylex.props(styles.pair)}
      >
        {answers.map((answer) => (
          <button
            key={String(answer.value)}
            type="button"
            role="radio"
            aria-checked={draft === answer.value}
            disabled={disabled}
            {...stylex.props(styles.pairOne, draft === answer.value && styles.pairOn)}
            onClick={() => onDraft(answer.value)}
          >
            {answer.label}
          </button>
        ))}
      </span>
    )
  }
  if (kind === 'boolean')
    // Three states on purpose. Unanswered wears the platform's mixed mark,
    // and only a person's click turns it into an explicit yes or no - so a
    // box nobody has reached is not quietly reported as "no", and the
    // check that says a field is still unanswered has something to point
    // at. An empty box would have said "no" for everybody who never looked.
    return (
      <Checkbox
        id={id}
        checked={draft === undefined ? 'indeterminate' : draft === true}
        disabled={disabled}
        onCheckedChange={(checked) => onDraft(checked === true)}
      />
    )
  if (kind === 'choice') {
    const choice = schema as ChoiceSchema
    return (
      <Select
        value={typeof draft === 'string' && draft !== '' ? draft : undefined}
        disabled={disabled}
        onValueChange={(value) => onDraft(value)}
      >
        <SelectTrigger id={id} xstyle={styles.control}>
          <SelectValue placeholder={words.unanswered} />
        </SelectTrigger>
        <SelectContent>
          {choice.enum.map((value) => (
            <SelectItem key={value} value={value}>
              {choiceLabel(choice, value, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (kind === 'date')
    return (
      <DatePicker
        id={id}
        value={typeof draft === 'string' && draft !== '' ? draft : null}
        disabled={disabled}
        placeholder={words.unanswered}
        clearLabel={words.clear}
        localeTag={locale}
        monthLabel={words.month}
        yearLabel={words.year}
        onChange={(next) => onDraft(next ?? '')}
      />
    )
  return (
    <Input
      id={id}
      value={typeof draft === 'string' ? draft : draft === undefined ? '' : String(draft)}
      disabled={disabled}
      inputMode={kind === 'integer' ? 'numeric' : kind === 'decimal' ? 'decimal' : undefined}
      onChange={(event) => onDraft(event.target.value)}
    />
  )
}

export interface AtomicValueFieldProps {
  readonly schema: AtomicSchema
  readonly name: string
  readonly draft: FieldDraft | undefined
  readonly onDraft: (draft: FieldDraft) => void
  readonly locale: string
  readonly disabled?: boolean
  /** already-translated words about what stops this field */
  readonly problem?: string
  /** overrides the annotation/key label (e.g. an output's own caption) */
  readonly label?: string
  /** see {@link ValueFieldWords} */
  readonly words: ValueFieldWords
  /** see {@link ExplainFieldProblem} */
  readonly explain?: ExplainFieldProblem
  /** see {@link FieldAuthoring}; ignored when a label is given */
  readonly authoring?: FieldAuthoring
  /** keep the label for assistive technology but draw none: for a control
   *  sitting in a row that already names it */
  readonly hideLabel?: boolean
  /** a small mark riding the label's line, where no authoring key does */
  readonly labelAside?: ReactNode
}

/**
 * One schema-typed field on its own: the expected-output box and every
 * parameter of the input form are the same control.
 */
export function AtomicValueField({
  schema,
  name,
  draft,
  onDraft,
  locale,
  disabled = false,
  problem,
  label,
  words,
  explain,
  authoring,
  hideLabel = false,
  labelAside,
}: AtomicValueFieldProps) {
  const description = displayDescription(schema, locale)
  const live = useLiveProblem(schema, name, draft, explain)
  // Once somebody has typed here, the live check owns the line: a problem
  // from the last run is about what the field held then, and leaving it
  // under a box that has since been corrected says the correction did not
  // take.
  const said = live.touched ? live.problem : problem
  const authored = label === undefined ? authoring : undefined
  const title = declaredTitle(schema, locale)
  const note = authoring?.noteOf?.(schema, name)
  return (
    <Field
      hideLabel={hideLabel}
      label={
        label ??
        (authored === undefined
          ? displayTitle(schema, name, locale)
          : (title ?? authored.unnamedLabel))
      }
      {...(note === undefined
        ? {}
        : authoring?.notePlacement === 'below'
          ? { hint: note }
          : { note })}
      {...(authored === undefined
        ? labelAside === undefined
          ? {}
          : { aside: labelAside }
        : {
            aside: (
              <code
                data-field-key={name}
                data-titled={title !== undefined}
                {...stylex.props(styles.key)}
              >
                {name}
              </code>
            ),
          })}
    >
      {(id) => (
        <div data-parameter={name} data-invalid={said === undefined ? undefined : true}>
          <AtomicControl
            schema={schema}
            name={name}
            draft={draft}
            onDraft={onDraft}
            locale={locale}
            disabled={disabled}
            id={id}
            words={words}
          />
          {description === undefined ? null : (
            <p {...stylex.props(styles.description)}>{description}</p>
          )}
          {said === undefined ? null : (
            <p {...stylex.props(styles.problem)} role="alert">
              {said}
            </p>
          )}
        </div>
      )}
    </Field>
  )
}

/**
 * A field's own verdict on what is in it, a beat after the typing stops.
 *
 * Debounced, because judging a number while it is half typed calls `-` and
 * `1.` wrong on the way to `-1.5`. Silent until the field has been touched:
 * an untouched form is not a form full of mistakes, it is a form.
 */
function useLiveProblem(
  schema: AtomicSchema,
  name: string,
  draft: FieldDraft | undefined,
  explain: ExplainFieldProblem | undefined,
): { touched: boolean; problem: string | undefined } {
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [touched, setTouched] = useState(false)
  const first = useRef(true)
  // Whether this field has ever held an answer. Emptiness is only worth
  // saying once it is a deletion: a field nobody has reached yet is not a
  // mistake, and a form that opens covered in "required" has told the
  // reader nothing except that it is a form.
  const held = useRef(false)
  if (draft !== undefined && draft !== '') held.current = true
  useEffect(() => {
    if (explain === undefined) return
    // the draft this field opened with is not something somebody typed
    if (first.current) {
      first.current = false
      return
    }
    setTouched(true)
    const timer = setTimeout(() => {
      const reason = checkField(schema, draft)
      const said = reason === 'required' && !held.current ? undefined : reason
      setProblem(said === undefined ? undefined : explain(schema, name, said))
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [schema, name, draft, explain])
  return { touched, problem }
}

/**
 * The form itself: one field per spec, in the array's order.
 *
 * Ids are opaque - nothing here parses or constrains them - so the same
 * component serves an input contract's parameter names and a recognition
 * contract's stable identities alike.
 */
export function ValueFieldsForm({
  fields,
  drafts,
  onDraft,
  locale,
  disabled = false,
  problems,
  scope,
  words,
  explain,
  authoring,
  asideOf,
}: ValueFieldsFormProps) {
  return (
    <div {...stylex.props(styles.grid)} data-testid={`value-form-${scope}`}>
      {fields.map((field) => {
        const problem = problems?.get(field.id)
        return (
          <AtomicValueField
            key={field.id}
            schema={field.schema}
            name={field.id}
            draft={Object.hasOwn(drafts, field.id) ? drafts[field.id] : undefined}
            onDraft={(draft) => onDraft(field.id, draft)}
            locale={locale}
            disabled={disabled}
            words={words}
            {...(explain === undefined ? {} : { explain })}
            {...(problem === undefined ? {} : { problem })}
            {...(authoring === undefined ? {} : { authoring })}
            {...(asideOf === undefined ? {} : { labelAside: asideOf(field.id) })}
          />
        )
      })}
    </div>
  )
}

/** the input-contract face: parameters in authored order */
export function InputValueForm({ schema, ...rest }: InputValueFormProps) {
  return <ValueFieldsForm fields={fieldsOfInput(schema)} {...rest} />
}
