import * as stylex from '@stylexjs/stylex'
import { createContext, use, useRef, useState, type ReactNode, type RefObject } from 'react'
import { PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { layout } from '@qualy/ui/theme/layout.stylex'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { ArrowLeftIcon } from 'lucide-react'
import { workbenchStyles as w } from './workbench-styles.ts'
import { formulaMessages as m } from './i18n.ts'
import {
  DEFAULT_WORKBENCH_SIZES,
  useWorkbenchSizes,
  type WorkbenchSizes,
} from './workbench-sizes.ts'

// The formula workbench's frame, whatever it is showing.
//
// On a wide screen: a bar, the source on the left, then two columns - the
// try-run, and the formula's versions - each scrolling in its own place, and
// a panel of tabs under all three. Every edge between them can be dragged,
// and the sizes are remembered. Where two columns do not fit beside the
// source, they share one, versions first, behind a pair of tabs. On a phone
// the same parts are spread over tabs, one at a time, and whatever stands
// between the state and its next step stays at the foot of the screen.

/** below this viewport width the try-run and the versions share one column */
const SPLIT_COLUMNS_MIN_WIDTH = 1200
/** the least room a dragged edge leaves the source, a column and the upper area */
const SOURCE_MIN_WIDTH = 320
const COLUMN_MIN_WIDTH = 240
const UPPER_MIN_HEIGHT = 200
const PANEL_MIN_HEIGHT = 120
/** how far one arrow key moves an edge */
const KEY_STEP = 16

export type SideTab = 'try' | 'history'

/**
 * Whether the columns stand on their own or are reached through tabs. A
 * column's head repeats its tab's name when a tab already says it, so a head
 * that names a column steps aside there.
 */
const TabbedColumns = createContext(false)

/** how a view stands, for the dot on its tab */
export type Tone = 'good' | 'bad' | 'quiet'

export interface WorkbenchTab {
  readonly value: string
  readonly label: string
  readonly tone?: Tone
  readonly count?: number
  readonly content: ReactNode
}

const styles = stylex.create({
  workbench: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
    flexDirection: 'column',
    backgroundColor: tokens.background,
  },
  bar: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingBlock: 8,
    paddingInline: 20,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  barPhone: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 8,
    paddingTop: 6,
    paddingBottom: 12,
    paddingInline: layout.pageGutter,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  barRow: { display: 'flex', minHeight: 32, alignItems: 'center', gap: 8 },
  back: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingInline: 8,
    marginLeft: -8,
    borderRadius: tokens.radiusMd,
    fontSize: 13,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    backgroundColor: { default: null, ':hover': tokens.surfaceMuted },
    textDecoration: 'none',
  },
  rule: { width: 1, height: 16, flexShrink: 0, backgroundColor: tokens.border },
  heading: { display: 'flex', minWidth: 0, flexShrink: 1, flexDirection: 'column', gap: 2 },
  headingPhone: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
  // one height whatever the title is drawn with - an editable name or plain
  // words - so opening a piece of history does not move the page
  titleLine: { display: 'flex', minWidth: 0, height: 30, alignItems: 'center', gap: 8 },
  statusLine: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 4,
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  actions: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8 },

  upper: { display: 'flex', flexGrow: 1, minHeight: 0 },
  sourcePane: {
    position: 'relative',
    display: 'flex',
    minWidth: SOURCE_MIN_WIDTH,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexDirection: 'column',
    backgroundColor: tokens.surface,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
  },
  column: {
    display: 'flex',
    minWidth: COLUMN_MIN_WIDTH,
    minHeight: 0,
    flexShrink: 1,
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: tokens.background,
  },
  columnRuled: { borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: tokens.border },
  columnScroll: { minHeight: 0, flexGrow: 1, overflowY: 'auto' },
  columnFill: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  columnTabs: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },

  panel: {
    display: 'flex',
    minHeight: PANEL_MIN_HEIGHT,
    flexShrink: 0,
    flexDirection: 'column',
    backgroundColor: tokens.surface,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  panelBar: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  tabList: { gap: 0 },
  tab: { height: 38, gap: 7, paddingInline: 14, borderRadius: 0, fontSize: 12.5 },
  tabPhone: { height: 40, paddingInline: 12, borderRadius: 0, fontSize: 13 },
  // the tab wraps what it is given in a label of its own, so the spacing
  // between the dot, the name and the count has to be inside
  tabWords: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  tabCount: {
    fontSize: 11,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  panelBody: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },

  phoneTabs: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  phoneTabsFrame: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  phoneBody: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
    overflowY: 'auto',
    backgroundColor: tokens.surface,
  },
  gate: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    paddingBlock: 8,
    paddingInline: layout.pageGutter,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: tokens.background,
  },

  dot: {
    display: 'inline-block',
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  dotGood: { backgroundColor: tokens.success },
  dotBad: { backgroundColor: tokens.danger },

  // a column's name, as a bar the column hangs from: as tall as the source
  // pane's head beside it, on the same rule, so the three read as one row
  columnHead: {
    display: 'flex',
    height: 38,
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surface,
  },
  columnHeadIcon: { display: 'inline-flex', flexShrink: 0, color: tokens.mutedForeground },
  columnHeadTitle: {
    flexShrink: 0,
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: tokens.foreground,
  },
  edgeX: { position: 'relative', flexShrink: 0, width: 0, zIndex: 3 },
  edgeY: { position: 'relative', flexShrink: 0, height: 0, zIndex: 3 },
  // The hit area straddles the rule it moves; the rule lights up under the
  // pointer, under the keyboard and while it is being dragged.
  handle: {
    position: 'absolute',
    borderWidth: 0,
    padding: 0,
    outlineStyle: 'none',
    backgroundColor: 'transparent',
    touchAction: 'none',
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  handleX: {
    top: 0,
    bottom: 0,
    left: -4,
    width: 9,
    cursor: 'col-resize',
    backgroundImage: {
      default: 'none',
      ':hover': `linear-gradient(to right, transparent 3px, ${tokens.focusRing} 3px, ${tokens.focusRing} 6px, transparent 6px)`,
      ':focus-visible': `linear-gradient(to right, transparent 3px, ${tokens.focusRing} 3px, ${tokens.focusRing} 6px, transparent 6px)`,
      '[data-dragging]': `linear-gradient(to right, transparent 3px, ${tokens.focusRing} 3px, ${tokens.focusRing} 6px, transparent 6px)`,
    },
  },
  handleY: {
    left: 0,
    right: 0,
    top: -4,
    height: 9,
    cursor: 'row-resize',
    backgroundImage: {
      default: 'none',
      ':hover': `linear-gradient(to bottom, transparent 3px, ${tokens.focusRing} 3px, ${tokens.focusRing} 6px, transparent 6px)`,
      ':focus-visible': `linear-gradient(to bottom, transparent 3px, ${tokens.focusRing} 3px, ${tokens.focusRing} 6px, transparent 6px)`,
      '[data-dragging]': `linear-gradient(to bottom, transparent 3px, ${tokens.focusRing} 3px, ${tokens.focusRing} 6px, transparent 6px)`,
    },
  },
  sideHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingTop: 6,
    paddingInline: 16,
  },
  sideTitle: {
    flexShrink: 0,
    margin: 0,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: tokens.surfaceMutedForeground,
  },
  sideNote: {
    minWidth: 0,
    fontSize: 11,
    textAlign: 'right',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
})

/** the dot a tab or a line carries */
export function ToneDot({ tone }: { readonly tone: Tone }) {
  return (
    <span
      aria-hidden
      data-tone={tone}
      {...stylex.props(
        styles.dot,
        tone === 'good' && styles.dotGood,
        tone === 'bad' && styles.dotBad,
      )}
    />
  )
}

/**
 * A section's name, with a note and an action beside it. A head that names a
 * whole column is drawn as the column's bar, with an icon; where columns
 * share room behind tabs, the tab says the name and the bar steps aside.
 */
export function SideHead({
  title,
  note,
  action,
  icon,
  column = false,
}: {
  readonly title: string
  readonly note?: ReactNode
  readonly action?: ReactNode
  readonly icon?: ReactNode
  /** this head names a whole column */
  readonly column?: boolean
}) {
  const tabbed = use(TabbedColumns)
  if (column && tabbed) return null
  if (column)
    return (
      <div {...stylex.props(styles.columnHead)}>
        {icon === undefined ? null : <span {...stylex.props(styles.columnHeadIcon)}>{icon}</span>}
        <h2 {...stylex.props(styles.columnHeadTitle)}>{title}</h2>
        <span {...stylex.props(w.spring)} />
        {note}
        {action}
      </div>
    )
  return (
    <div {...stylex.props(styles.sideHead)}>
      <h2 {...stylex.props(styles.sideTitle)}>{title}</h2>
      <span {...stylex.props(w.spring)} />
      {note}
      {action}
    </div>
  )
}

/** the note a side section carries at its right edge */
export function SideNote({
  children,
  ...rest
}: {
  readonly children: ReactNode
  readonly 'data-testid'?: string
  readonly 'data-state'?: string
}) {
  return (
    <span {...rest} {...stylex.props(styles.sideNote)}>
      {children}
    </span>
  )
}

export function WorkbenchBar({
  narrow,
  backLabel,
  title,
  badge,
  status,
  actions,
  phoneMenu,
  titleRef,
}: {
  readonly narrow: boolean
  readonly backLabel: string
  readonly title: ReactNode
  readonly badge?: ReactNode
  readonly status?: ReactNode
  /** what a wide bar holds at its right edge */
  readonly actions?: ReactNode
  /** what a phone's bar holds beside the way back */
  readonly phoneMenu?: ReactNode
  readonly titleRef?: (node: HTMLElement | null) => void
}) {
  const back = (
    <PageLink page="assessment-formula/list" className={stylex.props(styles.back).className}>
      <ArrowLeftIcon size={15} aria-hidden />
      <span>{backLabel}</span>
    </PageLink>
  )
  if (narrow) {
    return (
      <header {...stylex.props(styles.barPhone)}>
        <div {...stylex.props(styles.barRow)}>
          {back}
          <span {...stylex.props(w.spring)} />
          {phoneMenu}
        </div>
        <div ref={titleRef} {...stylex.props(styles.headingPhone)}>
          <div {...stylex.props(styles.titleLine)}>{title}</div>
          <div {...stylex.props(styles.statusLine)}>
            {badge}
            {status}
          </div>
        </div>
      </header>
    )
  }
  return (
    <header {...stylex.props(styles.bar)}>
      {back}
      <span aria-hidden {...stylex.props(styles.rule)} />
      <div ref={titleRef} {...stylex.props(styles.heading)}>
        <div {...stylex.props(styles.titleLine)}>
          {title}
          {badge}
        </div>
        {status === undefined ? null : <div {...stylex.props(styles.statusLine)}>{status}</div>}
      </div>
      <span {...stylex.props(w.spring)} />
      <div {...stylex.props(styles.actions)}>{actions}</div>
    </header>
  )
}

/**
 * A draggable edge between two regions. It sizes the region AFTER it - the
 * column to its right, the panel below - so moving it toward that region
 * makes the region smaller. Arrow keys move it a step at a time, and a
 * double press puts the region back to its default size.
 */
function Edge({
  name,
  axis,
  label,
  value,
  fallback,
  limits,
  onResize,
}: {
  /** which size the edge moves, for a test to find it by */
  readonly name: keyof WorkbenchSizes
  readonly axis: 'x' | 'y'
  readonly label: string
  readonly value: number
  readonly fallback: number
  /** measured when a drag starts, since the room around it may have changed */
  readonly limits: () => { readonly min: number; readonly max: number }
  readonly onResize: (value: number, settle: boolean) => void
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef<{ pointer: number; value: number; min: number; max: number } | null>(null)
  const clamp = (next: number, min: number, max: number) => Math.min(Math.max(next, min), max)
  const at = (event: { clientX: number; clientY: number }) =>
    axis === 'x' ? event.clientX : event.clientY

  const settleKey = (delta: number) => {
    const { min, max } = limits()
    onResize(clamp(value + delta, min, Math.max(min, max)), true)
  }

  return (
    <div {...stylex.props(axis === 'x' ? styles.edgeX : styles.edgeY)}>
      <div
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
        aria-valuenow={value}
        data-testid="workbench-edge"
        data-size={name}
        data-dragging={dragging ? true : undefined}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          const { min, max } = limits()
          origin.current = { pointer: at(event), value, min, max: Math.max(min, max) }
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // a pointer the browser no longer tracks still drags while it moves over the edge
          }
          setDragging(true)
          document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
          document.body.style.userSelect = 'none'
        }}
        onPointerMove={(event) => {
          const start = origin.current
          if (start === null) return
          onResize(clamp(start.value - (at(event) - start.pointer), start.min, start.max), false)
        }}
        onPointerUp={(event) => {
          const start = origin.current
          if (start === null) return
          origin.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
          setDragging(false)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
          onResize(clamp(start.value - (at(event) - start.pointer), start.min, start.max), true)
        }}
        onDoubleClick={() => onResize(fallback, true)}
        onKeyDown={(event) => {
          const grow = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
          const shrink = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
          if (event.key === grow) settleKey(KEY_STEP)
          else if (event.key === shrink) settleKey(-KEY_STEP)
          else return
          event.preventDefault()
        }}
        {...stylex.props(styles.handle, axis === 'x' ? styles.handleX : styles.handleY)}
      />
    </div>
  )
}

/** the room a region may take, measured against what is around it now */
const widthOf = (ref: RefObject<HTMLElement | null>): number =>
  ref.current?.getBoundingClientRect().width ?? 0

function TabWords({ tab }: { readonly tab: WorkbenchTab }) {
  return (
    <span {...stylex.props(styles.tabWords)}>
      {tab.tone === undefined ? null : <ToneDot tone={tab.tone} />}
      {tab.label}
      {tab.count === undefined ? null : <span {...stylex.props(styles.tabCount)}>{tab.count}</span>}
    </span>
  )
}

export function WorkbenchLayout({
  narrow,
  testId,
  status,
  bar,
  notices,
  source,
  tryRun,
  history,
  sideTab,
  onSideTab,
  tryLabel,
  historyLabel,
  panelTabs,
  panelTab,
  onPanelTab,
  panelActions,
  panelLabel,
  phoneTabs,
  phoneTab,
  onPhoneTab,
  gate,
  children,
}: {
  readonly narrow: boolean
  readonly testId: string
  readonly status?: string
  readonly bar: ReactNode
  readonly notices?: ReactNode
  readonly source: ReactNode
  /** the try-run column, head included; it scrolls on its own */
  readonly tryRun: ReactNode
  /** the history column; it lays out its own scrolling list */
  readonly history: ReactNode
  /** which of the two shows when they share a column */
  readonly sideTab: SideTab
  readonly onSideTab: (tab: SideTab) => void
  readonly tryLabel: string
  readonly historyLabel: string
  readonly panelTabs: readonly WorkbenchTab[]
  readonly panelTab: string
  readonly onPanelTab: (value: string) => void
  readonly panelActions?: ReactNode
  readonly panelLabel: string
  readonly phoneTabs: readonly WorkbenchTab[]
  readonly phoneTab: string
  readonly onPhoneTab: (value: string) => void
  /** a phone's standing foot: what is between this state and its next step */
  readonly gate?: ReactNode
  /** sheets and dialogs that belong to the view */
  readonly children?: ReactNode
}) {
  const { format } = useI18n()
  const shared = useIsBelow(SPLIT_COLUMNS_MIN_WIDTH)
  const { sizes, resize } = useWorkbenchSizes()
  const workbenchRef = useRef<HTMLDivElement | null>(null)
  const upperRef = useRef<HTMLDivElement | null>(null)
  const size = (key: keyof WorkbenchSizes) => (value: number, settle: boolean) =>
    resize(key, value, settle)
  if (narrow) {
    return (
      <TabbedColumns value>
        <div data-testid={testId} data-status={status} {...stylex.props(styles.workbench)}>
          {bar}
          {notices}
          <Tabs value={phoneTab} onValueChange={onPhoneTab} xstyle={styles.phoneTabsFrame}>
            <div {...stylex.props(styles.phoneTabs)}>
              <TabsList aria-label={panelLabel} xstyle={styles.tabList}>
                {phoneTabs.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} xstyle={styles.tabPhone}>
                    <TabWords tab={tab} />
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {phoneTabs.map((tab) => (
              <TabsContent key={tab.value} value={tab.value} xstyle={styles.phoneBody}>
                {tab.content}
              </TabsContent>
            ))}
          </Tabs>
          {gate === undefined ? null : <div {...stylex.props(styles.gate)}>{gate}</div>}
          {children}
        </div>
      </TabbedColumns>
    )
  }
  const panelLimits = () => {
    const whole = workbenchRef.current?.getBoundingClientRect()
    const upper = upperRef.current?.getBoundingClientRect()
    if (whole === undefined || upper === undefined) return { min: PANEL_MIN_HEIGHT, max: 600 }
    return {
      min: PANEL_MIN_HEIGHT,
      max: whole.bottom - upper.top - UPPER_MIN_HEIGHT,
    }
  }
  const columnLimits = (others: number) => () => ({
    min: COLUMN_MIN_WIDTH,
    max: widthOf(upperRef) - SOURCE_MIN_WIDTH - others,
  })

  return (
    <div
      ref={workbenchRef}
      data-testid={testId}
      data-status={status}
      {...stylex.props(styles.workbench)}
    >
      {bar}
      {notices}
      <div
        ref={upperRef}
        {...stylex.props(styles.upper)}
        data-columns={shared ? 'shared' : 'split'}
      >
        {/* first on either width, so the source is never rebuilt when the columns fold */}
        <div {...stylex.props(styles.sourcePane)}>{source}</div>
        {shared ? (
          <TabbedColumns value>
            <Edge
              axis="x"
              label={format(m.resizeSide)}
              value={sizes.sideWidth}
              fallback={DEFAULT_WORKBENCH_SIZES.sideWidth}
              limits={columnLimits(0)}
              name="sideWidth"
              onResize={size('sideWidth')}
            />
            <aside {...stylex.props(styles.column)} style={{ flexBasis: sizes.sideWidth }}>
              <Tabs
                value={sideTab}
                onValueChange={(next) => onSideTab(next as SideTab)}
                xstyle={styles.columnFill}
              >
                <div {...stylex.props(styles.columnTabs)}>
                  <TabsList aria-label={`${historyLabel} ${tryLabel}`} xstyle={styles.tabList}>
                    <TabsTrigger value="history" xstyle={styles.tab}>
                      {historyLabel}
                    </TabsTrigger>
                    <TabsTrigger value="try" xstyle={styles.tab}>
                      {tryLabel}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="history" xstyle={styles.columnFill}>
                  {history}
                </TabsContent>
                <TabsContent value="try" xstyle={styles.columnScroll}>
                  {tryRun}
                </TabsContent>
              </Tabs>
            </aside>
          </TabbedColumns>
        ) : (
          <>
            <Edge
              axis="x"
              label={format(m.resizeTry)}
              value={sizes.tryWidth}
              fallback={DEFAULT_WORKBENCH_SIZES.tryWidth}
              limits={columnLimits(sizes.historyWidth)}
              name="tryWidth"
              onResize={size('tryWidth')}
            />
            <section
              aria-label={tryLabel}
              {...stylex.props(styles.column)}
              style={{ flexBasis: sizes.tryWidth }}
            >
              <div {...stylex.props(styles.columnScroll)}>{tryRun}</div>
            </section>
            <Edge
              axis="x"
              label={format(m.resizeHistory)}
              value={sizes.historyWidth}
              fallback={DEFAULT_WORKBENCH_SIZES.historyWidth}
              limits={columnLimits(sizes.tryWidth)}
              name="historyWidth"
              onResize={size('historyWidth')}
            />
            <section
              aria-label={historyLabel}
              {...stylex.props(styles.column, styles.columnRuled)}
              style={{ flexBasis: sizes.historyWidth }}
            >
              {history}
            </section>
          </>
        )}
      </div>
      <Edge
        axis="y"
        label={format(m.resizePanel)}
        value={sizes.panelHeight}
        fallback={DEFAULT_WORKBENCH_SIZES.panelHeight}
        limits={panelLimits}
        name="panelHeight"
        onResize={size('panelHeight')}
      />
      <Tabs
        value={panelTab}
        onValueChange={onPanelTab}
        xstyle={styles.panel}
        style={{ height: sizes.panelHeight }}
      >
        <div {...stylex.props(styles.panelBar)}>
          <TabsList aria-label={panelLabel} xstyle={styles.tabList}>
            {panelTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} xstyle={styles.tab}>
                <TabWords tab={tab} />
              </TabsTrigger>
            ))}
          </TabsList>
          <span {...stylex.props(w.spring)} />
          {panelActions}
        </div>
        {panelTabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} xstyle={styles.panelBody}>
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
      {children}
    </div>
  )
}
