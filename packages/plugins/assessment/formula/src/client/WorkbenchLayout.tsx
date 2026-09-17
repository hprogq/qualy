import * as stylex from '@stylexjs/stylex'
import { createContext, use, type ReactNode } from 'react'
import { PageLink } from '@qualy/web-runtime'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { layout } from '@qualy/ui/theme/layout.stylex'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { ArrowLeftIcon } from 'lucide-react'
import { workbenchStyles as w } from './workbench-styles.ts'

// The formula workbench's frame, whatever it is showing.
//
// On a wide screen: a bar, the source on the left, then two columns of the
// same width - the try-run, and the formula's history - each scrolling in
// its own place, and a panel of tabs under all three. Where two columns do
// not fit beside the source, they share one and a pair of tabs switches
// between them. On a phone the same parts are spread over tabs, one at a
// time, and whatever stands between the state and its next step stays at
// the foot of the screen.

/** below this viewport width the try-run and the history share one column */
const SPLIT_COLUMNS_MIN_WIDTH = 1200

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
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
    backgroundColor: tokens.surface,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
  },
  column: {
    display: 'flex',
    width: { default: 324, [breakpoints.tablet]: 300 },
    minHeight: 0,
    flexShrink: 0,
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
    height: 268,
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

  sideHeadGap: { height: 12, flexShrink: 0 },
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

/** a section of the right-hand column: its name, a note, an action */
export function SideHead({
  title,
  note,
  action,
  column = false,
}: {
  readonly title: string
  readonly note?: ReactNode
  readonly action?: ReactNode
  /** this head names a whole column, which a tab names instead where columns share room */
  readonly column?: boolean
}) {
  const tabbed = use(TabbedColumns)
  if (column && tabbed && note === undefined && action === undefined)
    return <div aria-hidden {...stylex.props(styles.sideHeadGap)} />
  return (
    <div {...stylex.props(styles.sideHead)}>
      {column && tabbed ? null : <h2 {...stylex.props(styles.sideTitle)}>{title}</h2>}
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
  const shared = useIsBelow(SPLIT_COLUMNS_MIN_WIDTH)
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
  return (
    <div data-testid={testId} data-status={status} {...stylex.props(styles.workbench)}>
      {bar}
      {notices}
      <div {...stylex.props(styles.upper)} data-columns={shared ? 'shared' : 'split'}>
        {/* first on either width, so the source is never rebuilt when the columns fold */}
        <div {...stylex.props(styles.sourcePane)}>{source}</div>
        {shared ? (
          <TabbedColumns value>
            <aside {...stylex.props(styles.column)}>
              <Tabs
                value={sideTab}
                onValueChange={(next) => onSideTab(next as SideTab)}
                xstyle={styles.columnFill}
              >
                <div {...stylex.props(styles.columnTabs)}>
                  <TabsList aria-label={`${tryLabel} ${historyLabel}`} xstyle={styles.tabList}>
                    <TabsTrigger value="try" xstyle={styles.tab}>
                      {tryLabel}
                    </TabsTrigger>
                    <TabsTrigger value="history" xstyle={styles.tab}>
                      {historyLabel}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="try" xstyle={styles.columnScroll}>
                  {tryRun}
                </TabsContent>
                <TabsContent value="history" xstyle={styles.columnFill}>
                  {history}
                </TabsContent>
              </Tabs>
            </aside>
          </TabbedColumns>
        ) : (
          <>
            <section aria-label={tryLabel} {...stylex.props(styles.column)}>
              <div {...stylex.props(styles.columnScroll)}>{tryRun}</div>
            </section>
            <section aria-label={historyLabel} {...stylex.props(styles.column, styles.columnRuled)}>
              {history}
            </section>
          </>
        )}
      </div>
      <Tabs value={panelTab} onValueChange={onPanelTab} xstyle={styles.panel}>
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
