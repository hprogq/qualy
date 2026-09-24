import * as stylex from '@stylexjs/stylex'
import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FunctionSquareIcon,
  SearchIcon,
  SearchXIcon,
} from 'lucide-react'
import { PageLink, useApi, useApiQuery, useRunApi, cursorPages } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { displayTitle, inputOrder, type InputSchema } from '@qualy/value-schema'
import { Button } from '@qualy/ui/button'
import { Feedback } from '@qualy/ui/admin'
import { Input } from '@qualy/ui/input'
import type { CalculatorEditorContext } from '@qualy/plugin-assessment/surfaces'
import { formulaApi } from './api.ts'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { formulaMessages as m } from './i18n.ts'

// Choosing which published formula a question is scored by, in two steps:
// which formula, then which of its publications.
//
// One list of every publication made a formula with seven of them seven
// rows saying the same name, and the choice that matters first - which
// arithmetic - had to be read out of the repetition. So the first step is
// one row per formula, and the second is that formula's history with
// nothing else in the way. Both fill the same frame, so stepping between
// them moves nothing but the list.
//
// The list is what this round may bind TODAY; the binding a question already
// has is answered separately and stays choosable however its function ended
// up - a version withdrawn from new bindings is still the lawful thing this
// question runs, and taking it away from the picker would turn "rename the
// question" into "rebind or lose it".

const REF = 'formula@1'

const FORMULA_COLUMNS = 'minmax(0, 1.6fr) minmax(0, 1fr) 6.5rem 1rem'
const VERSION_COLUMNS = '1rem minmax(0, 1.6fr) minmax(0, 1fr) 6.5rem'

const styles = stylex.create({
  frame: { display: 'flex', minWidth: 0, minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  bar: {
    flexShrink: 0,
    paddingInline: 20,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  search: { position: 'relative', display: 'flex', width: '100%', alignItems: 'center' },
  searchSeat: { width: '100%' },
  searchIcon: {
    position: 'absolute',
    left: 10,
    width: 14,
    height: 14,
    color: tokens.mutedForeground,
    pointerEvents: 'none',
  },
  searchInput: { height: 34, paddingLeft: 32, fontSize: 13 },
  // the formula chosen in the first step, kept in sight through the second
  echo: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    paddingLeft: 12,
    paddingRight: 20,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  echoWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 3 },
  echoName: { fontSize: 14, fontWeight: 600 },
  back: { flexShrink: 0, color: tokens.mutedForeground },
  head: {
    display: 'grid',
    flexShrink: 0,
    columnGap: 16,
    alignItems: 'center',
    height: 32,
    paddingInline: 20,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: tokens.mutedForeground,
  },
  formulaColumns: { gridTemplateColumns: FORMULA_COLUMNS },
  versionColumns: { gridTemplateColumns: VERSION_COLUMNS },
  // the list scrolls; the frame around it never changes size
  list: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column', overflowY: 'auto' },
  row: {
    display: 'grid',
    flexShrink: 0,
    columnGap: 16,
    alignItems: 'center',
    width: '100%',
    paddingInline: 20,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  formulaRow: { paddingBlock: 14 },
  versionRow: { minHeight: 56, paddingBlock: 8 },
  rowChosen: { backgroundColor: tokens.surfaceMuted },
  rowHeld: { color: tokens.mutedForeground },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 3 },
  nameLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13.5,
    fontWeight: 600,
  },
  sub: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  tags: { display: 'flex', minWidth: 0, flexWrap: 'wrap', gap: 4 },
  tagsEnd: { flexShrink: 1, justifyContent: 'flex-end' },
  tag: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    maxWidth: '100%',
    height: 18,
    paddingInline: 6,
    borderRadius: 5,
    backgroundColor: tokens.surfaceMuted,
    // a chosen row is the same grey: the hairline keeps the tag a tag there
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
    fontSize: 11,
    fontWeight: 400,
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  more: { fontSize: 11, lineHeight: '18px', color: tokens.mutedForeground },
  latest: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  latestWords: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.success,
  },
  chevron: { width: 14, height: 14, color: tokens.mutedForeground },
  cell: { fontSize: 12, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  radio: {
    display: 'inline-flex',
    width: 16,
    height: 16,
    borderRadius: '9999px',
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.foreground} 22%, transparent)`,
  },
  radioOn: { boxShadow: `inset 0 0 0 5px ${tokens.foreground}` },
  blank: {
    display: 'flex',
    flexGrow: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 24,
    textAlign: 'center',
  },
  blankIcon: { width: 22, height: 22, marginBottom: 4, color: tokens.mutedForeground },
  blankTitle: { fontSize: 13.5, fontWeight: 600 },
  blankHint: { fontSize: 12, color: tokens.mutedForeground },
  moreRow: { display: 'flex', flexShrink: 0, justifyContent: 'center', paddingBlock: 8 },
  foot: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    minHeight: 58,
    paddingInline: 20,
    paddingBlock: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  footQuiet: { backgroundColor: tokens.surfaceInset },
  footWords: { minWidth: 0, fontSize: 12, color: tokens.mutedForeground },
  spacer: { flexGrow: 1 },
  manage: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
    fontSize: 12.5,
    fontWeight: 500,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    textDecoration: 'none',
  },
  icon12: { width: 12, height: 12 },
})

interface Option {
  readonly versionId: string
  readonly functionId: string
  readonly functionName: string
  readonly functionDescription: string | null
  readonly versionNo: number
  readonly releaseName: string | null
  readonly releaseNotes: string | null
  readonly publishedAt: string
  readonly parameters: readonly string[]
  readonly inputSchema: unknown
  readonly bindableForNew: boolean
  /** the binding this question already has, offered today or not */
  readonly current: boolean
}

interface Formula {
  readonly functionId: string
  readonly name: string
  readonly description: string | null
  /** newest first */
  readonly versions: readonly Option[]
}

/** the parameters in the order their author wrote them, under the words the reader's locale has for them */
const parameterWords = (option: Option, locale: string): readonly string[] => {
  const schema = option.inputSchema as InputSchema | null
  if (schema === null || typeof schema !== 'object' || schema.properties === undefined)
    return option.parameters
  return inputOrder(schema).map((key) => {
    const own = schema.properties[key]
    return own === undefined ? key : displayTitle(own, key, locale)
  })
}

const TAGS_SHOWN = 3

function ParameterTags({ words, end = false }: { words: readonly string[]; end?: boolean }) {
  const { format } = useI18n()
  const listJoin = useList()
  const shown = words.length > TAGS_SHOWN + 1 ? words.slice(0, TAGS_SHOWN) : words
  return (
    <span {...stylex.props(styles.tags, end && styles.tagsEnd)} title={listJoin(words)}>
      {shown.map((word) => (
        <span key={word} {...stylex.props(styles.tag)}>
          {word}
        </span>
      ))}
      {shown.length < words.length && (
        <span {...stylex.props(styles.more)}>
          {format(m.bindingMoreParameters, { count: words.length - shown.length })}
        </span>
      )}
    </span>
  )
}

export default function CalculatorEditor({ context }: { context: CalculatorEditorContext }) {
  const { format, formatError, locale } = useI18n()
  const api = useApi(formulaApi)
  const query = useApiQuery(formulaApi)
  const runApi = useRunApi()
  const mine = context.calculator.ref === REF
  const chosen = mine
    ? (((context.calculator.config as { versionId?: unknown } | null)?.versionId as
        | string
        | undefined) ?? null)
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
    const current = pages[0]?.current ?? null
    const offered = pages.flatMap((page) =>
      page.items.map((item) => ({
        ...item,
        bindableForNew: true,
        current: item.versionId === current?.versionId,
      })),
    )
    // the binding this question already has, wherever it landed in policy:
    // once, and never twice if it is also on offer
    if (current === null || offered.some((one) => one.versionId === current.versionId))
      return offered
    return [{ ...current, current: true }, ...offered]
  }, [versions.data])

  // A formula is one thing with a history. Grouped by identity rather than
  // by name, because two formulas may be called the same and the reader
  // would then be choosing a version of something else.
  const formulas = useMemo((): readonly Formula[] => {
    const order: string[] = []
    const byFunction = new Map<
      string,
      { name: string; description: string | null; versions: Option[] }
    >()
    for (const option of options) {
      const held = byFunction.get(option.functionId)
      if (held === undefined) {
        order.push(option.functionId)
        byFunction.set(option.functionId, {
          name: option.functionName,
          description: option.functionDescription,
          versions: [option],
        })
        continue
      }
      held.versions.push(option)
    }
    return order.map((functionId) => {
      const held = byFunction.get(functionId)!
      return {
        functionId,
        name: held.name,
        description: held.description,
        versions: [...held.versions].sort((a, b) => b.versionNo - a.versionNo),
      }
    })
  }, [options])

  const [search, setSearch] = useState('')
  const [opened, setOpened] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(chosen)

  if (!mine) return null

  const inUse = options.find((one) => one.versionId === chosen) ?? null
  const needle = search.trim().toLowerCase()
  const matching =
    needle === ''
      ? formulas
      : formulas.filter(
          (one) =>
            one.name.toLowerCase().includes(needle) ||
            (one.description ?? '').toLowerCase().includes(needle),
        )
  const formula = opened === null ? undefined : formulas.find((one) => one.functionId === opened)
  const releaseWords = (option: Option) =>
    option.releaseName ?? format(m.bindingReleaseNo, { no: option.versionNo })
  const dateWords = (iso: string) => {
    const at = new Date(iso)
    return new Intl.DateTimeFormat(locale, {
      ...(at.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
      month: 'long',
      day: 'numeric',
    }).format(at)
  }

  if (formula !== undefined) {
    const latest = formula.versions.find((one) => one.bindableForNew)
    const candidate = formula.versions.find((one) => one.versionId === selected) ?? null
    const impact = ((): string => {
      if (candidate === null) return ''
      if (candidate.versionId === chosen) return format(m.bindingImpactChosen)
      if (inUse === null)
        return format(m.bindingImpactFresh, { count: candidate.parameters.length })
      const added = candidate.parameters.filter((one) => !inUse.parameters.includes(one)).length
      const removed = inUse.parameters.filter((one) => !candidate.parameters.includes(one)).length
      if (added > 0) return format(m.bindingImpactAdded, { count: added })
      if (removed > 0) return format(m.bindingImpactRemoved, { count: removed })
      return format(m.bindingImpactSame)
    })()
    const use = () => {
      if (candidate === null) return
      const next = { ref: REF, config: { versionId: candidate.versionId } }
      context.onChange(next)
      context.chooser?.commit(next)
    }
    return (
      <div {...stylex.props(styles.frame)} data-testid="formula-version-picker" data-step="version">
        <div {...stylex.props(styles.echo)}>
          <Button
            variant="ghost"
            size="icon-sm"
            className={stylex.props(styles.back).className}
            onClick={() => setOpened(null)}
            aria-label={format(m.bindingBack)}
          >
            <ArrowLeftIcon aria-hidden />
          </Button>
          <div {...stylex.props(styles.echoWords)}>
            <span {...stylex.props(styles.echoName)}>{formula.name}</span>
            {formula.description !== null && formula.description !== '' && (
              <span {...stylex.props(styles.sub)}>{formula.description}</span>
            )}
          </div>
          {formula.versions[0] !== undefined && (
            <ParameterTags end words={parameterWords(candidate ?? formula.versions[0], locale)} />
          )}
        </div>
        <div {...stylex.props(styles.head, styles.versionColumns)}>
          <span />
          <span>{format(m.bindingColVersion)}</span>
          <span>{format(m.bindingColRelease)}</span>
          <span>{format(m.bindingColDate)}</span>
        </div>
        <div
          role="radiogroup"
          aria-label={format(m.bindingColVersion)}
          {...stylex.props(styles.list)}
        >
          {formula.versions.map((option) => {
            const held = context.disabled || !(option.bindableForNew || option.current)
            const on = option.versionId === selected
            return (
              <button
                key={option.versionId}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={held}
                data-testid="formula-version-option"
                data-version-id={option.versionId}
                data-version-origin={option.bindableForNew ? 'offered' : 'current'}
                data-version-chosen={on}
                {...stylex.props(
                  styles.row,
                  styles.versionRow,
                  styles.versionColumns,
                  on && styles.rowChosen,
                  !option.bindableForNew && styles.rowHeld,
                )}
                onClick={() => setSelected(option.versionId)}
              >
                <span aria-hidden {...stylex.props(styles.radio, on && styles.radioOn)} />
                <span {...stylex.props(styles.words)}>
                  <span {...stylex.props(styles.nameLine)}>
                    <span {...stylex.props(styles.name)}>{releaseWords(option)}</span>
                    {option.versionId === chosen && (
                      <span {...stylex.props(styles.tag)}>{format(m.bindingInUse)}</span>
                    )}
                    {option.versionId === latest?.versionId && (
                      <span {...stylex.props(styles.tag)}>{format(m.bindingLatest)}</span>
                    )}
                  </span>
                  {!option.bindableForNew ? (
                    <span {...stylex.props(styles.sub)}>{format(m.bindingWithdrawn)}</span>
                  ) : (
                    option.releaseNotes !== null &&
                    option.releaseNotes.trim() !== '' && (
                      <span {...stylex.props(styles.sub)} title={option.releaseNotes}>
                        {option.releaseNotes}
                      </span>
                    )
                  )}
                </span>
                <span {...stylex.props(styles.cell)}>
                  {format(m.bindingReleaseNo, { no: option.versionNo })}
                </span>
                <span {...stylex.props(styles.cell)}>{dateWords(option.publishedAt)}</span>
              </button>
            )
          })}
        </div>
        <div {...stylex.props(styles.foot)}>
          <span {...stylex.props(styles.footWords)} data-testid="formula-version-impact">
            {impact}
          </span>
          <span {...stylex.props(styles.spacer)} />
          <Button variant="outline" onClick={() => setOpened(null)}>
            {format(m.bindingPrevious)}
          </Button>
          <Button
            disabled={candidate === null || candidate.versionId === chosen}
            onClick={use}
            data-testid="formula-version-use"
          >
            {format(m.bindingUse)}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div {...stylex.props(styles.frame)} data-testid="formula-version-picker" data-step="formula">
      <div {...stylex.props(styles.bar)}>
        <div {...stylex.props(styles.search)}>
          <SearchIcon aria-hidden {...stylex.props(styles.searchIcon)} />
          <Input
            type="search"
            value={search}
            aria-label={format(m.bindingSearch)}
            placeholder={format(m.bindingSearch)}
            wrapperXstyle={styles.searchSeat}
            className={stylex.props(styles.searchInput).className}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div {...stylex.props(styles.head, styles.formulaColumns)}>
        <span>{format(m.bindingColFormula)}</span>
        <span>{format(m.bindingColParameters)}</span>
        <span>{format(m.bindingColLatest)}</span>
        <span />
      </div>
      <div {...stylex.props(styles.list)}>
        {versions.isError ? <Feedback message={formatError(versions.error)} /> : null}
        {versions.isPending ? (
          <div {...stylex.props(styles.blank)}>
            <span {...stylex.props(styles.blankHint)}>{format(m.bindingLoading)}</span>
          </div>
        ) : matching.length === 0 ? (
          <div
            {...stylex.props(styles.blank)}
            data-testid="formula-picker-empty"
            data-searching={needle !== ''}
          >
            {needle === '' ? (
              <FunctionSquareIcon aria-hidden {...stylex.props(styles.blankIcon)} />
            ) : (
              <SearchXIcon aria-hidden {...stylex.props(styles.blankIcon)} />
            )}
            <span {...stylex.props(styles.blankTitle)}>
              {format(needle === '' ? m.bindingEmptyTitle : m.bindingNoMatchTitle)}
            </span>
            <span {...stylex.props(styles.blankHint)}>
              {format(needle === '' ? m.bindingEmptyHint : m.bindingNoMatchHint)}
            </span>
          </div>
        ) : (
          matching.map((one) => {
            const latest = one.versions.find((option) => option.bindableForNew) ?? one.versions[0]!
            const holdsCurrent = one.versions.some((option) => option.versionId === chosen)
            return (
              <button
                key={one.functionId}
                type="button"
                disabled={context.disabled}
                data-testid="formula-option"
                data-function-id={one.functionId}
                data-current={holdsCurrent}
                {...stylex.props(styles.row, styles.formulaRow, styles.formulaColumns)}
                onClick={() => {
                  // the version in use stays marked; anywhere else the newest is the likely choice
                  setSelected(holdsCurrent ? chosen : latest.versionId)
                  setOpened(one.functionId)
                }}
              >
                <span {...stylex.props(styles.words)}>
                  <span {...stylex.props(styles.nameLine)}>
                    <span {...stylex.props(styles.name)}>{one.name}</span>
                    {holdsCurrent && (
                      <span {...stylex.props(styles.tag)}>{format(m.bindingCurrent)}</span>
                    )}
                  </span>
                  {one.description !== null && one.description !== '' && (
                    <span {...stylex.props(styles.sub)}>{one.description}</span>
                  )}
                </span>
                <ParameterTags words={parameterWords(latest, locale)} />
                <span {...stylex.props(styles.latest)}>
                  <span aria-hidden {...stylex.props(styles.dot)} />
                  <span {...stylex.props(styles.latestWords)}>{releaseWords(latest)}</span>
                </span>
                <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
              </button>
            )
          })
        )}
        {versions.hasNextPage ? (
          <div {...stylex.props(styles.moreRow)}>
            <Button
              variant="ghost"
              disabled={versions.isFetchingNextPage}
              onClick={() => void versions.fetchNextPage()}
            >
              {format(m.bindingMore)}
            </Button>
          </div>
        ) : null}
      </div>
      <div {...stylex.props(styles.foot, styles.footQuiet)}>
        <span
          {...stylex.props(styles.footWords)}
          data-testid="formula-count"
          data-count={formulas.length}
        >
          {format(m.bindingCount, { count: formulas.length })}
        </span>
        <span {...stylex.props(styles.spacer)} />
        <PageLink page="assessment-formula/list" className={stylex.props(styles.manage).className}>
          {format(m.bindingManage)}
          <ChevronRightIcon aria-hidden {...stylex.props(styles.icon12)} />
        </PageLink>
      </div>
    </div>
  )
}
