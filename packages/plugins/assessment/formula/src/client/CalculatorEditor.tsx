import * as stylex from '@stylexjs/stylex'
import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Badge } from '@qualy/ui/badge'
import { Feedback, Field } from '@qualy/ui/admin'
import type { CalculatorEditorContext } from '@qualy/plugin-assessment/surfaces'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'

// Choosing which published formula a question is scored by.
//
// The list is what this round may bind TODAY; the binding a question already
// has is answered separately and stays choosable however its function ended
// up - a version withdrawn from new bindings is still the lawful thing this
// question runs, and taking it away from the picker would turn "rename the
// question" into "rebind or lose it".

const REF = 'formula@1'

const styles = stylex.create({
  frame: { display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 320 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.625rem',
    borderRadius: '0.375rem',
    border: '1px solid var(--q-border)',
    background: 'var(--q-surface)',
    textAlign: 'left',
    width: '100%',
    cursor: 'pointer',
  },
  chosen: { borderColor: 'var(--q-primary)' },
  held: { cursor: 'not-allowed', opacity: 0.55 },
  name: { fontWeight: 500 },
  meta: { fontSize: '0.8125rem', color: 'var(--q-surface-muted-foreground)' },
  spacer: { marginInlineStart: 'auto' },
})

interface Option {
  readonly versionId: string
  readonly functionName: string
  readonly versionNo: number
  readonly parameters: readonly string[]
  readonly bindableForNew: boolean
  readonly current: boolean
}

export default function CalculatorEditor({ context }: { context: CalculatorEditorContext }) {
  const { format, formatError } = useI18n()
  const api = useApi(formulaApi)
  const query = useApiQuery(formulaApi)
  const runApi = useRunApi()
  const mine = context.calculator.ref === REF
  const chosen = mine
    ? ((context.calculator.config as { versionId?: unknown } | null)?.versionId ?? null)
    : null

  const request = {
    params: { batchId: context.batchId },
    query: context.itemId === null ? {} : { itemId: context.itemId },
  }
  const versions = useInfiniteQuery({
    queryKey: [...query.assessmentFormula.listFormulaBindingOptions.key(request), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.assessmentFormula.listFormulaBindingOptions({
          ...request,
          query: {
            ...request.query,
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: mine,
  })

  const options = useMemo((): readonly Option[] => {
    const pages = versions.data?.pages ?? []
    const offered = pages.flatMap((page) =>
      page.items.map((item) => ({ ...item, bindableForNew: true, current: false })),
    )
    // the binding this question already has, wherever it landed in policy:
    // once, and never twice if it is also on offer
    const current = pages[0]?.current ?? null
    if (current === null || offered.some((one) => one.versionId === current.versionId)) {
      return offered
    }
    return [{ ...current, current: true }, ...offered]
  }, [versions.data])

  if (!mine) return null

  return (
    <Field label={format(m.bindingTitle)}>
      {() => (
        <div {...stylex.props(styles.frame)} data-testid="formula-version-picker">
          {versions.isError ? <Feedback message={formatError(versions.error)} /> : null}
          {options.map((option) => {
            const held = context.disabled || !(option.bindableForNew || option.current)
            return (
              <button
                key={option.versionId}
                type="button"
                disabled={held}
                data-testid="formula-version-option"
                data-version-id={option.versionId}
                data-version-origin={option.current ? 'current' : 'offered'}
                data-version-chosen={option.versionId === chosen}
                {...stylex.props(
                  styles.row,
                  option.versionId === chosen && styles.chosen,
                  held && styles.held,
                )}
                onClick={() =>
                  context.onChange({ ref: REF, config: { versionId: option.versionId } })
                }
              >
                <span {...stylex.props(styles.name)}>{option.functionName}</span>
                <span {...stylex.props(styles.meta)}>
                  {format(m.versionNumber, { number: option.versionNo })}
                </span>
                <span {...stylex.props(styles.meta)}>
                  {format(m.bindingParameters, { names: option.parameters.join('、') })}
                </span>
                {option.current && !option.bindableForNew ? (
                  <span {...stylex.props(styles.spacer)}>
                    <Badge variant="secondary">{format(m.bindingKeptOnly)}</Badge>
                  </span>
                ) : null}
              </button>
            )
          })}
          {versions.hasNextPage ? (
            <Button
              variant="ghost"
              disabled={versions.isFetchingNextPage}
              onClick={() => void versions.fetchNextPage()}
            >
              {format(m.bindingMore)}
            </Button>
          ) : null}
        </div>
      )}
    </Field>
  )
}
