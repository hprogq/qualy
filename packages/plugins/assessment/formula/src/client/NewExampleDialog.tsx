import * as stylex from '@stylexjs/stylex'
import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Field, FormDialog } from '@qualy/ui/admin'
import type { AtomicSchema, NormalizedAtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'
import { AtomicValueField, InputValueForm } from '@qualy/web-value-form/InputValueForm'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { materializeInput, type FieldDraft } from '@qualy/web-value-form/model'
import { formulaMessages as m } from './i18n.ts'
import { inputIssueWords, fieldIssueWords } from './report-words.ts'

// A new example, written out before it joins the list: its name, what goes
// in, and what should come out. Nothing is added until it is confirmed, so a
// dialog opened by mistake leaves no empty row behind.

export interface NewExample {
  readonly name: string
  readonly inputText: string
  readonly expected: string
}

const styles = stylex.create({
  fields: { display: 'flex', flexDirection: 'column', gap: 14 },
  problem: { margin: 0, fontSize: 12, color: tokens.danger },
})

export function NewExampleDialog({
  open,
  contract,
  initial,
  expectedProblem,
  onClose,
  onAdd,
}: {
  readonly open: boolean
  /** what the dialog opens with, when it opens from a try that already ran */
  readonly initial?: {
    readonly drafts?: Readonly<Record<string, FieldDraft>>
    readonly expected?: string
  }
  /** the structure a form is drawn from; without one the input is typed as JSON */
  readonly contract: {
    readonly inputSchema: NormalizedInputSchema
    readonly outputSchema: NormalizedAtomicSchema
  } | null
  /** what is wrong with an expectation, in words, or null */
  readonly expectedProblem: (expected: string) => string | null
  readonly onClose: () => void
  readonly onAdd: (example: NewExample) => void
}) {
  const { format, locale } = useI18n()
  const words = usePickerWords()
  // the live check is the form's; the words for what it finds are this
  // screen's, and they are the same ones a run reports
  const explain = useCallback(
    (schema: AtomicSchema, _id: string, reason: string) => fieldIssueWords(format, schema, reason),
    [format],
  )
  const [name, setName] = useState('')
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({})
  const [inputText, setInputText] = useState('')
  const [expected, setExpected] = useState('')
  const [issues, setIssues] = useState<ReadonlyMap<string, string> | undefined>(undefined)
  const [inputProblem, setInputProblem] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  // every opening is a new example, seeded by whatever opened it
  useEffect(() => {
    if (!open) return
    setName('')
    setDrafts(initial?.drafts ?? {})
    setInputText('')
    setExpected(initial?.expected ?? '')
    setIssues(undefined)
    setInputProblem(null)
    setChecked(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const expectation = checked ? expectedProblem(expected) : null

  const add = () => {
    setChecked(true)
    let stored: string
    if (contract !== null) {
      const materialized = materializeInput(contract.inputSchema, drafts)
      if (materialized.value === null) {
        setIssues(inputIssueWords(format, contract.inputSchema, materialized.issues))
        return
      }
      setIssues(undefined)
      stored = JSON.stringify(materialized.value)
    } else {
      try {
        stored = JSON.stringify(JSON.parse(inputText === '' ? '{}' : inputText))
        setInputProblem(null)
      } catch {
        setInputProblem(format(m.testInputInvalid, { label: name === '' ? '#' : name }))
        return
      }
    }
    if (expectedProblem(expected) !== null) return
    onAdd({ name: name.trim(), inputText: stored, expected })
  }

  return (
    <FormDialog
      open={open}
      title={format(m.exampleNewTitle)}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button data-testid="formula-example-add-confirm" onClick={add}>
            {format(m.exampleAddConfirm)}
          </Button>
        </>
      }
    >
      <div data-testid="formula-example-new" {...stylex.props(styles.fields)}>
        <Field label={format(m.testName)}>
          {(id) => (
            <Input
              id={id}
              value={name}
              maxLength={100}
              placeholder={format(m.exampleNamePlaceholder)}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        {contract === null ? (
          <Field label={format(m.testInput)}>
            {(id) => (
              <Input
                id={id}
                placeholder={'{"value": "2.34"}'}
                value={inputText}
                aria-invalid={inputProblem !== null}
                onChange={(event) => setInputText(event.target.value)}
              />
            )}
          </Field>
        ) : (
          <InputValueForm
            explain={explain}
            words={words}
            schema={contract.inputSchema}
            drafts={drafts}
            onDraft={(field, draft) => setDrafts({ ...drafts, [field]: draft })}
            locale={locale}
            problems={issues}
            scope="new-example"
            authoring={{ unnamedLabel: format(m.fieldUnnamed) }}
          />
        )}
        {inputProblem === null ? null : (
          <p role="alert" {...stylex.props(styles.problem)}>
            {inputProblem}
          </p>
        )}
        {contract === null ? (
          <Field label={format(m.testExpected)}>
            {(id) => (
              <Input
                id={id}
                placeholder={format(m.expectedLabel)}
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
              />
            )}
          </Field>
        ) : (
          <AtomicValueField
            explain={explain}
            words={words}
            schema={contract.outputSchema}
            name="expected"
            label={format(m.expectedLabel)}
            draft={expected}
            onDraft={(draft) => setExpected(typeof draft === 'string' ? draft : String(draft))}
            locale={locale}
            {...(expectation === null ? {} : { problem: expectation })}
          />
        )}
      </div>
    </FormDialog>
  )
}
