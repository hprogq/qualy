import * as stylex from '@stylexjs/stylex'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import type { CalculatorSummaryContext } from '@qualy/plugin-assessment/surfaces'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'

// The one line the question editor shows for a formula: its name, which
// publication, and what the author called that release. Only this plugin
// knows a version by name, so only it can say.

const REF = 'formula@1'

const styles = stylex.create({
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 3 },
  head: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  version: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  dot: { width: 6, height: 6, borderRadius: '9999px', backgroundColor: tokens.success },
  note: { fontSize: 12, color: tokens.mutedForeground },
})

export default function CalculatorSummary({ context }: { context: CalculatorSummaryContext }) {
  const { format } = useI18n()
  const query = useApiQuery(formulaApi)
  const mine = context.calculator.ref === REF
  const versionId = mine
    ? ((context.calculator.config as { versionId?: unknown } | null)?.versionId ?? null)
    : null
  const options = useQuery({
    ...query.assessmentFormula.listFormulaBindingOptions.queryOptions({
      params: { batchId: context.batchId },
      query: context.itemId === null ? {} : { itemId: context.itemId },
    }),
    enabled: mine && versionId !== null,
  })
  if (!mine) return null
  const offered = [
    ...(options.data?.items ?? []),
    ...(options.data?.current === null || options.data?.current === undefined
      ? []
      : [options.data.current]),
  ]
  const found = offered.find((one) => one.versionId === versionId)
  return (
    <div {...stylex.props(styles.words)} data-testid="calculator-summary" data-version={versionId ?? ''}>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.name)}>
          {found === undefined ? format(m.bindingTitle) : found.functionName}
        </span>
        {found !== undefined && (
          <span {...stylex.props(styles.version)}>
            <span aria-hidden {...stylex.props(styles.dot)} />
            {format(m.summaryVersion, { no: found.versionNo })}
          </span>
        )}
      </div>
      <span {...stylex.props(styles.note)}>
        {found === undefined
          ? versionId === null
            ? format(m.summaryUnchosen)
            : format(m.summaryUnknown)
          : (found.functionDescription ??
            found.releaseName ??
            format(m.bindingParameterCount, { count: found.parameters.length }))}
      </span>
    </div>
  )
}
