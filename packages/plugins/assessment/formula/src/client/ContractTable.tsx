import * as stylex from '@stylexjs/stylex'
import {
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  MAX_SCALE,
  choiceLabel,
  displayTitle,
  inputOrder,
  kindOf,
  type AtomicSchema,
  type ChoiceSchema,
  type DecimalSchema,
  type IntegerSchema,
  type NormalizedAtomicSchema,
  type NormalizedInputSchema,
  type TextSchema,
} from '@qualy/value-schema'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { formulaMessages as m } from './i18n.ts'
import { kindWords } from './kind-words.ts'

// What the draft takes and gives, as the compiler read it.
//
// The try-run form asks for values; this says what values are allowed, one
// parameter a line, so an author can check that the structure they wrote is
// the structure they meant before a question is bound to it. It reads the
// contract only - nothing here is the author's words about the parameters.

const styles = stylex.create({
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  head: {
    height: 30,
    paddingInline: 16,
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 500,
    color: tokens.mutedForeground,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    whiteSpace: 'nowrap',
  },
  cell: {
    height: 34,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    verticalAlign: 'middle',
  },
  key: {
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 11.5,
    color: tokens.surfaceMutedForeground,
    whiteSpace: 'nowrap',
  },
  quiet: { color: tokens.mutedForeground },
  rules: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  output: { fontWeight: 500 },
})

type Format = ReturnType<typeof useI18n>['format']

const bounds = (format: Format, min: string | undefined, max: string | undefined) => {
  if (min !== undefined && max !== undefined) return [format(m.constraintRange, { min, max })]
  if (min !== undefined) return [format(m.constraintAtLeast, { min })]
  if (max !== undefined) return [format(m.constraintAtMost, { max })]
  return []
}

/** what a schema allows, as short separate statements */
const rulesOf = (schema: AtomicSchema, format: Format, locale: string): readonly string[] => {
  switch (kindOf(schema)) {
    case 'integer': {
      const integer = schema as IntegerSchema
      return bounds(format, String(integer.minimum), String(integer.maximum))
    }
    case 'decimal': {
      const decimal = schema as DecimalSchema
      return [
        ...bounds(format, decimal[DECIMAL_MINIMUM], decimal[DECIMAL_MAXIMUM]),
        format(m.constraintScale, { scale: decimal[MAX_SCALE] }),
      ]
    }
    case 'choice': {
      const choice = schema as ChoiceSchema
      return [choice.enum.map((value) => choiceLabel(choice, value, locale)).join(' / ')]
    }
    case 'text': {
      const text = schema as TextSchema
      const length =
        text.minLength !== undefined && text.maxLength !== undefined
          ? [format(m.constraintLength, { min: text.minLength, max: text.maxLength })]
          : text.maxLength !== undefined
            ? [format(m.constraintMaxLength, { max: text.maxLength })]
            : []
      return [
        ...length,
        ...(text.pattern === undefined
          ? []
          : [format(m.constraintPattern, { pattern: text.pattern })]),
      ]
    }
    default:
      return []
  }
}

export function ContractTable({
  inputSchema,
  outputSchema,
}: {
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
}) {
  const { format, locale } = useI18n()
  const rules = (schema: AtomicSchema) => {
    const said = rulesOf(schema, format, locale)
    return said.length === 0 ? (
      <span {...stylex.props(styles.quiet)}>{format(m.constraintNone)}</span>
    ) : (
      <span {...stylex.props(styles.rules)}>
        {said.map((rule) => (
          <span key={rule}>{rule}</span>
        ))}
      </span>
    )
  }
  const required = new Set(inputSchema.required)
  return (
    <table {...stylex.props(styles.table)} data-testid="formula-contract">
      <thead>
        <tr>
          <th {...stylex.props(styles.head)}>{format(m.parametersLabel)}</th>
          <th {...stylex.props(styles.head)}>{format(m.parameterTitle)}</th>
          <th {...stylex.props(styles.head)}>{format(m.parameterKind)}</th>
          <th {...stylex.props(styles.head)}>{format(m.parameterRule)}</th>
        </tr>
      </thead>
      <tbody>
        {inputOrder(inputSchema).map((key) => {
          const schema = inputSchema.properties[key]
          if (schema === undefined) return null
          const title = displayTitle(schema, key, locale)
          return (
            <tr key={key} data-parameter={key}>
              <td {...stylex.props(styles.cell, styles.key)}>{key}</td>
              <td {...stylex.props(styles.cell, title === key && styles.quiet)}>
                {title === key ? '—' : title}
              </td>
              <td {...stylex.props(styles.cell)}>
                {kindWords(format, kindOf(schema))}
                {required.has(key) ? null : (
                  <span {...stylex.props(styles.quiet)}> {format(m.parameterOptional)}</span>
                )}
              </td>
              <td {...stylex.props(styles.cell)}>{rules(schema)}</td>
            </tr>
          )
        })}
        <tr data-parameter="">
          <td {...stylex.props(styles.cell, styles.output)}>{format(m.parameterOutput)}</td>
          <td {...stylex.props(styles.cell, styles.quiet)}>—</td>
          <td {...stylex.props(styles.cell)}>{kindWords(format, kindOf(outputSchema))}</td>
          <td {...stylex.props(styles.cell)}>{rules(outputSchema)}</td>
        </tr>
      </tbody>
    </table>
  )
}
