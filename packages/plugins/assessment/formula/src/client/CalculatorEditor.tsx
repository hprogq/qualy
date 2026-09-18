import * as stylex from '@stylexjs/stylex'
import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi, cursorPages } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Badge } from '@qualy/ui/badge'
import { Feedback, Field } from '@qualy/ui/admin'
import type { CalculatorEditorContext } from '@qualy/plugin-assessment/surfaces'
import { formulaApi } from './api.ts'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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
  frame: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 10 },
  // One card per formula, not one row per publication. Seven publications
  // of one formula were seven lines each repeating its name, and the last
  // of them carried every parameter it declares - which, with no floor on
  // how far a flex child may shrink, wrung the name itself into a column of
  // single characters.
  group: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 8,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surface,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    paddingInline: 12,
    paddingBlock: 10,
  },
  groupHead: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  // how many it takes, not which: the parameters themselves are the list
  // below this one, where each is configured
  meta: { fontSize: 12, color: tokens.mutedForeground },
  versions: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  version: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    borderWidth: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 10,
    paddingBlock: 4,
    fontFamily: 'inherit',
    fontSize: 12,
    color: tokens.foreground,
    cursor: { default: 'pointer', ':disabled': 'not-allowed' },
  },
  chosen: {
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
  held: { opacity: 0.55 },
})

interface Option {
  readonly versionId: string
  readonly functionId: string
  readonly functionName: string
  readonly versionNo: number
  readonly releaseName: string | null
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
    ...cursorPages,
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

  // A formula is one thing with a history, so it is one card with its
  // publications in it. Grouped by identity rather than by name, because two
  // formulas may be called the same and the reader would then be choosing a
  // version of something else.
  const grouped = useMemo(() => {
    const order: string[] = []
    const byFunction = new Map<
      string,
      { functionId: string; functionName: string; parameters: number; versions: Option[] }
    >()
    for (const option of options) {
      const held = byFunction.get(option.functionId)
      if (held === undefined) {
        order.push(option.functionId)
        byFunction.set(option.functionId, {
          functionId: option.functionId,
          functionName: option.functionName,
          parameters: option.parameters.length,
          versions: [option],
        })
        continue
      }
      held.versions.push(option)
    }
    return order.map((functionId) => byFunction.get(functionId)!)
  }, [options])

  if (!mine) return null

  return (
    <Field label={format(m.bindingTitle)}>
      {() => (
        <div {...stylex.props(styles.frame)} data-testid="formula-version-picker">
          {versions.isError ? <Feedback message={formatError(versions.error)} /> : null}
          {grouped.map((group) => (
            <div key={group.functionId} {...stylex.props(styles.group)}>
              <div {...stylex.props(styles.groupHead)}>
                <span {...stylex.props(styles.name)}>{group.functionName}</span>
                <span {...stylex.props(styles.meta)}>
                  {format(m.bindingParameterCount, { count: group.parameters })}
                </span>
              </div>
              <div {...stylex.props(styles.versions)} role="radiogroup">
                {group.versions.map((option) => {
                  const held = context.disabled || !(option.bindableForNew || option.current)
                  return (
                    <button
                      key={option.versionId}
                      type="button"
                      role="radio"
                      aria-checked={option.versionId === chosen}
                      disabled={held}
                      data-testid="formula-version-option"
                      data-version-id={option.versionId}
                      data-version-origin={option.current ? 'current' : 'offered'}
                      data-version-chosen={option.versionId === chosen}
                      {...stylex.props(
                        styles.version,
                        option.versionId === chosen && styles.chosen,
                        held && styles.held,
                      )}
                      onClick={() =>
                        context.onChange({ ref: REF, config: { versionId: option.versionId } })
                      }
                    >
                      {option.releaseName ??
                        format(m.releaseOrdinal, { number: option.versionNo })}
                      {option.current && !option.bindableForNew ? (
                        <Badge variant="secondary">{format(m.bindingKeptOnly)}</Badge>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
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
