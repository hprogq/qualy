import * as stylex from '@stylexjs/stylex'
import {
  displayTitle,
  inputOrder,
  kindOf,
  type AtomicSchema,
  type NormalizedAtomicSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { formulaMessages as m } from './i18n.ts'
import { kindWords } from './kind-words.ts'
import { constraintRules } from './constraint-words.ts'

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

export function ContractTable({
  inputSchema,
  outputSchema,
}: {
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
}) {
  const { format, locale } = useI18n()
  const rules = (schema: AtomicSchema) => {
    const said = constraintRules(schema, format, locale)
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
                {title === key ? format(m.fieldUnnamed) : title}
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
          <td {...stylex.props(styles.cell)} />
          <td {...stylex.props(styles.cell)}>{kindWords(format, kindOf(outputSchema))}</td>
          <td {...stylex.props(styles.cell)}>{rules(outputSchema)}</td>
        </tr>
      </tbody>
    </table>
  )
}
