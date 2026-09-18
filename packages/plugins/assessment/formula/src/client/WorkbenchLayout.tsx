import * as stylex from '@stylexjs/stylex'
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { layout } from '@qualy/ui/theme/layout.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Skeleton } from '@qualy/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@qualy/ui/tabs'
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
// On a wide screen: a bar, the source, the try-run beside it, and under both
// a full-width panel of checks - the examples, what the compiler made of the
// code, the structure it takes. Whatever stands between the draft and a
// publication is one standing line at the very foot, and what is neither
// checked nor published - the versions, the tries this browser remembers -
// waits behind a drawer. On a phone the same parts are spread over one row
// of tabs, with that line and the two decisions standing under them.

/** the least room a dragged edge leaves the source, the column and the upper area */
const SOURCE_MIN_WIDTH = 320
const TRY_MIN_WIDTH = 280
const UPPER_MIN_HEIGHT = 200
const PANEL_MIN_HEIGHT = 120
/** how far one arrow key moves an edge */
const KEY_STEP = 16

/**
 * How a view stands, for the dot on its tab.
 *
 * 'working' is its own face on purpose: while the compiler is being asked
 * again, the answer is not yet known, and a dot that vanishes and comes back
 * reads as a fault of the page rather than as work in progress.
 */
export type Tone = 'good' | 'bad' | 'warn' | 'working' | 'quiet'

export interface WorkbenchTab {
  readonly value: string
  readonly label: string
  readonly tone?: Tone
  readonly count?: number
  readonly content: ReactNode
}

/** the one line between this state and a publication, at the foot of every width */
export interface WorkbenchGate {
  /** what the line is about, said once at its left edge */
  readonly label: string
  readonly tone: Tone
  readonly words: string
  /** the step that settles it, when there is one */
  readonly action?: ReactNode
  readonly testId?: string
}

// A state opened from the versions arrives from the right, the way it was
// picked, and the draft comes back from the left. Only a press inside the
// page moves anything: a link straight to a version simply is there.
const slideForward = stylex.keyframes({
  from: { transform: 'translateX(24px)', opacity: 0 },
  to: { transform: 'translateX(0)', opacity: 1 },
})
const slideBack = stylex.keyframes({
  from: { transform: 'translateX(-24px)', opacity: 0 },
  to: { transform: 'translateX(0)', opacity: 1 },
})

const REDUCED = '@media (prefers-reduced-motion: reduce)'

const styles = stylex.create({
  // the slide happens inside a layer the frame clips, so the page never widens
  moving: { overflowX: 'clip' },
  movingLayer: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  movingForward: {
    animationName: { default: slideForward, [REDUCED]: 'none' },
    animationDuration: '200ms',
    animationTimingFunction: 'ease-out',
  },
  movingBack: {
    animationName: { default: slideBack, [REDUCED]: 'none' },
    animationDuration: '200ms',
    animationTimingFunction: 'ease-out',
  },
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
  // a frozen state is not the draft, and the bar is where that is noticed:
  // a tint across the whole bar, with the same rule under it as any other
  barFrozen: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 7%, ${tokens.background})`,
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
  // words - so opening a version does not move the page
  titleLine: { display: 'flex', minWidth: 0, height: 30, alignItems: 'center', gap: 8 },
  statusLine: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
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
  tryPane: {
    display: 'flex',
    minWidth: TRY_MIN_WIDTH,
    minHeight: 0,
    flexShrink: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: tokens.surface,
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
    backgroundColor: tokens.background,
  },
  tabList: { gap: 0 },
  tab: { height: 38, gap: 7, paddingInline: 12, borderRadius: 0, fontSize: 12.5 },
  tabPhone: { height: 40, gap: 6, paddingInline: 11, borderRadius: 0, fontSize: 13 },
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

  // The workbench before it arrives, drawn from the same styles the real one
  // uses: the same bar, the same split, the same panel at the same heights.
  // What lands then lands in an outline already on screen, instead of
  // replacing four grey lines in a corner with a three-pane tool.
  waitBar: { display: 'flex', alignItems: 'center', gap: 12, paddingInline: 12 },
  waitSpring: { flexGrow: 1 },
  waitCode: { display: 'flex', flexDirection: 'column', gap: 9, padding: 16 },
  waitTry: { display: 'flex', flexDirection: 'column', gap: 14, padding: 16 },
  waitField: { display: 'flex', flexDirection: 'column', gap: 6 },
  waitPanel: { display: 'flex', flexDirection: 'column', gap: 10, padding: 16 },
  waitRow: { display: 'flex', alignItems: 'center', gap: 12 },
  waitTabs: { display: 'flex', alignItems: 'center', gap: 16, paddingInline: 12 },

  phoneTabs: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    overflowX: 'auto',
    scrollbarWidth: 'none',
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

  // the standing line: one fact and at most one step, whatever tab is open
  gate: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingInline: { default: 20, [breakpoints.phone]: layout.pageGutter },
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: tokens.surfaceInset,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  gateLabel: {
    flexShrink: 0,
    marginRight: 2,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: tokens.surfaceMutedForeground,
  },
  gateWords: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // the two decisions, standing under every tab a phone shows
  foot: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    paddingBottom: 14,
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
  dotWarn: { backgroundColor: tokens.warning },
  // the answer is on its way: a ring where a filled dot will be
  dotWorking: {
    backgroundColor: 'transparent',
    boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${tokens.mutedForeground} 55%, transparent)`,
  },

  // a column's name, as a bar the column hangs from: as tall as the source
  // pane's head beside it, on the same rule, so the two read as one row
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
  columnTitle: {
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
        tone === 'warn' && styles.dotWarn,
        tone === 'working' && styles.dotWorking,
      )}
    />
  )
}

/** a column's name, as the bar the column hangs from */
export function ColumnHead({
  title,
  note,
  action,
}: {
  readonly title: string
  readonly note?: ReactNode
  readonly action?: ReactNode
}) {
  return (
    <div {...stylex.props(styles.columnHead)}>
      <h2 {...stylex.props(styles.columnTitle)}>{title}</h2>
      <span {...stylex.props(w.spring)} />
      {note}
      {action}
    </div>
  )
}

export function WorkbenchBar({
  narrow,
  frozen = false,
  backLabel,
  onBack,
  title,
  badge,
  status,
  actions,
  phoneActions,
  phoneMenu,
  titleRef,
}: {
  readonly narrow: boolean
  /** this bar stands over a state that cannot be edited */
  readonly frozen?: boolean
  readonly backLabel: string
  /** where the way back goes, when it is not the list of formulas */
  readonly onBack?: () => void
  readonly title: ReactNode
  readonly badge?: ReactNode
  readonly status?: ReactNode
  /** what a wide bar holds at its right edge */
  readonly actions?: ReactNode
  /** what a phone's bar holds beside the way back */
  readonly phoneActions?: ReactNode
  readonly phoneMenu?: ReactNode
  readonly titleRef?: (node: HTMLElement | null) => void
}) {
  const back =
    onBack === undefined ? (
      <PageLink page="assessment-formula/list" className={stylex.props(styles.back).className}>
        <ArrowLeftIcon size={15} aria-hidden />
        <span>{backLabel}</span>
      </PageLink>
    ) : (
      <button
        type="button"
        data-testid="formula-back-to-draft"
        onClick={onBack}
        {...stylex.props(styles.back)}
      >
        <ArrowLeftIcon size={15} aria-hidden />
        <span>{backLabel}</span>
      </button>
    )
  if (narrow) {
    return (
      <header {...stylex.props(styles.barPhone, frozen && styles.barFrozen)}>
        <div {...stylex.props(styles.barRow)}>
          {back}
          <span {...stylex.props(w.spring)} />
          {phoneActions}
          {phoneMenu}
        </div>
        <div ref={titleRef} {...stylex.props(styles.headingPhone)}>
          <div {...stylex.props(styles.titleLine)}>
            {title}
            {badge}
          </div>
          <div {...stylex.props(styles.statusLine)}>{status}</div>
        </div>
      </header>
    )
  }
  return (
    <header {...stylex.props(styles.bar, frozen && styles.barFrozen)}>
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
      {tab.tone === undefined || tab.tone === 'quiet' ? null : <ToneDot tone={tab.tone} />}
      {tab.label}
      {tab.count === undefined ? null : <span {...stylex.props(styles.tabCount)}>{tab.count}</span>}
    </span>
  )
}

function GateLine({ gate }: { readonly gate: WorkbenchGate }) {
  return (
    <div data-testid={gate.testId} data-tone={gate.tone} {...stylex.props(styles.gate)}>
      <span {...stylex.props(styles.gateLabel)}>{gate.label}</span>
      <ToneDot tone={gate.tone} />
      <span {...stylex.props(styles.gateWords)}>{gate.words}</span>
      <span {...stylex.props(w.spring)} />
      {gate.action}
    </div>
  )
}

export function WorkbenchLayout({
  narrow,
  testId,
  status,
  motion,
  bar,
  notices,
  source,
  tryRun,
  tryLabel,
  panelTabs,
  panelTab,
  onPanelTab,
  panelActions,
  panelLabel,
  phoneTabs,
  phoneTab,
  onPhoneTab,
  gate,
  foot,
  children,
}: {
  readonly narrow: boolean
  readonly testId: string
  readonly status?: string
  /** this state was just reached from inside the page: it arrives from a side */
  readonly motion?: 'forward' | 'back'
  readonly bar: ReactNode
  readonly notices?: ReactNode
  readonly source: ReactNode
  /** the try-run column, its head included */
  readonly tryRun: ReactNode
  readonly tryLabel: string
  readonly panelTabs: readonly WorkbenchTab[]
  readonly panelTab: string
  readonly onPanelTab: (value: string) => void
  readonly panelActions?: ReactNode
  readonly panelLabel: string
  readonly phoneTabs: readonly WorkbenchTab[]
  readonly phoneTab: string
  readonly onPhoneTab: (value: string) => void
  /** the standing line at the foot of either width */
  readonly gate?: WorkbenchGate
  /** a phone's standing decisions, under the line */
  readonly foot?: ReactNode
  /** drawers and dialogs that belong to the view */
  readonly children?: ReactNode
}) {
  const { format } = useI18n()
  const { sizes, resize } = useWorkbenchSizes()
  const workbenchRef = useRef<HTMLDivElement | null>(null)
  const upperRef = useRef<HTMLDivElement | null>(null)
  const size = (key: keyof WorkbenchSizes) => (value: number, settle: boolean) =>
    resize(key, value, settle)
  if (narrow) {
    return (
      <div
        data-testid={testId}
        data-status={status}
        {...stylex.props(styles.workbench, motion !== undefined && styles.moving)}
      >
        <div
          {...stylex.props(
            styles.movingLayer,
            motion === 'forward' && styles.movingForward,
            motion === 'back' && styles.movingBack,
          )}
        >
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
          {gate === undefined ? null : <GateLine gate={gate} />}
          {foot === undefined ? null : <div {...stylex.props(styles.foot)}>{foot}</div>}
        </div>
        {children}
      </div>
    )
  }
  const panelLimits = () => {
    const whole = workbenchRef.current?.getBoundingClientRect()
    const upper = upperRef.current?.getBoundingClientRect()
    if (whole === undefined || upper === undefined) return { min: PANEL_MIN_HEIGHT, max: 600 }
    return { min: PANEL_MIN_HEIGHT, max: whole.bottom - upper.top - UPPER_MIN_HEIGHT }
  }
  const tryLimits = () => ({
    min: TRY_MIN_WIDTH,
    max: widthOf(upperRef) - SOURCE_MIN_WIDTH,
  })

  return (
    <div
      ref={workbenchRef}
      data-testid={testId}
      data-status={status}
      {...stylex.props(styles.workbench, motion !== undefined && styles.moving)}
    >
      <div
        {...stylex.props(
          styles.movingLayer,
          motion === 'forward' && styles.movingForward,
          motion === 'back' && styles.movingBack,
        )}
      >
        {bar}
        {notices}
        <div ref={upperRef} {...stylex.props(styles.upper)}>
          <div {...stylex.props(styles.sourcePane)}>{source}</div>
          <Edge
            axis="x"
            label={format(m.resizeTry)}
            value={sizes.tryWidth}
            fallback={DEFAULT_WORKBENCH_SIZES.tryWidth}
            limits={tryLimits}
            name="tryWidth"
            onResize={size('tryWidth')}
          />
          <section
            aria-label={tryLabel}
            {...stylex.props(styles.tryPane)}
            style={{ width: sizes.tryWidth }}
          >
            {tryRun}
          </section>
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
        {gate === undefined ? null : <GateLine gate={gate} />}
      </div>
      {children}
    </div>
  )
}

/** an uneven run of code, because a stack of equal bars reads as a progress bar */
const CODE_WIDTHS = ['38%', '64%', '52%', '71%', '44%', '58%', '30%', '66%', '48%', '35%']

/**
 * The workbench, waiting.
 *
 * Its own layout rather than a placeholder in a corner: the bar, the source
 * pane beside the try column at the width the reader last left it, and the
 * panel under both. A formula editor is a three-pane tool, and four grey
 * lines said nothing about which three.
 */
export function WorkbenchSkeleton({ narrow }: { narrow: boolean }) {
  const { sizes } = useWorkbenchSizes()
  const code = (
    <div {...stylex.props(styles.waitCode)}>
      {CODE_WIDTHS.map((width, index) => (
        <Skeleton key={index} height={11} width={width} radius={4} />
      ))}
    </div>
  )
  const tryColumn = (
    <div {...stylex.props(styles.waitTry)}>
      {[0, 1, 2].map((index) => (
        <span key={index} {...stylex.props(styles.waitField)}>
          <Skeleton height={10} width="34%" radius={4} />
          <Skeleton height={32} radius={6} />
        </span>
      ))}
      <span {...stylex.props(styles.waitRow)}>
        <Skeleton height={32} width="100%" radius={6} />
      </span>
    </div>
  )
  const panelRows = (
    <div {...stylex.props(styles.waitPanel)}>
      {['46%', '62%', '38%', '55%'].map((width, index) => (
        <span key={index} {...stylex.props(styles.waitRow)}>
          <Skeleton height={11} width={width} radius={4} />
          <span {...stylex.props(styles.waitSpring)} />
          <Skeleton height={11} width="4rem" radius={4} />
        </span>
      ))}
    </div>
  )
  const bar = (
    <div {...stylex.props(styles.bar)}>
      <span {...stylex.props(styles.waitBar)}>
        <Skeleton height={14} width={180} radius={4} />
        <Skeleton height={10} width={90} radius={4} />
      </span>
      <span {...stylex.props(styles.waitSpring)} />
      <span {...stylex.props(styles.waitBar)}>
        <Skeleton height={28} width={76} radius={6} />
        <Skeleton height={28} width={76} radius={6} />
      </span>
    </div>
  )

  if (narrow) {
    return (
      <div {...stylex.props(styles.workbench)} data-testid="formula-workbench-waiting" aria-busy>
        {bar}
        <div {...stylex.props(styles.phoneTabs, styles.waitTabs)}>
          {[60, 48, 54].map((width, index) => (
            <Skeleton key={index} height={11} width={width} radius={4} />
          ))}
        </div>
        {code}
      </div>
    )
  }
  return (
    <div {...stylex.props(styles.workbench)} data-testid="formula-workbench-waiting" aria-busy>
      {bar}
      <div {...stylex.props(styles.upper)}>
        <div {...stylex.props(styles.sourcePane)}>{code}</div>
        <section {...stylex.props(styles.tryPane)} style={{ width: sizes.tryWidth }}>
          {tryColumn}
        </section>
      </div>
      <div {...stylex.props(styles.panel)} style={{ height: sizes.panelHeight }}>
        <div {...stylex.props(styles.panelBar, styles.waitTabs)}>
          {[56, 44, 62].map((width, index) => (
            <Skeleton key={index} height={11} width={width} radius={4} />
          ))}
        </div>
        {panelRows}
      </div>
    </div>
  )
}
