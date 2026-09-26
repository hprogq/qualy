import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useWorkspaceMode, type WorkspaceMode } from './layout.ts'
import type { Viewer } from './model.ts'
import { statsShownFor } from './preferences.ts'

// The entries workspace before its reads come back, in the shape it is about
// to take: the same columns at the same widths for the width of the window,
// the structure's head with as many figures as the reader keeps out, a
// question's head, its toolbar and a few claims, and at a desk the
// requirements beside them. Drawn to that shape rather than as bars in
// general, so nothing jumps or appears from nowhere when the workspace takes
// its place. The widths are the workspace's own; its suite holds the two to
// the same columns.

/** where a desk is wide enough for the broader structure and requirements columns */
const WIDE = '@media (min-width: 1600px)'
const PHONE = '@media (max-width: 767.98px)'
const BELOW_DESK = '@media (max-width: 1279.98px)'

const styles = stylex.create({
  root: {
    display: 'grid',
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    gridTemplateRows: 'minmax(0, 1fr)',
    overflow: 'hidden',
    backgroundColor: tokens.background,
  },
  desk: {
    gridTemplateColumns: {
      default: '340px minmax(0, 1fr) 300px',
      [WIDE]: '380px minmax(0, 1fr) 360px',
    },
  },
  tablet: { gridTemplateColumns: '300px minmax(0, 1fr)' },
  // on a phone the workspace is part of the page, as tall as what it holds
  phone: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  },
  column: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flexDirection: 'column',
    overflow: 'hidden',
  },
  rail: { borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: tokens.border },
  railHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: { default: 20, [PHONE]: 16 },
    paddingTop: 18,
    paddingBottom: 12,
  },
  line: { display: 'flex', alignItems: 'center', gap: 8 },
  baseline: { display: 'flex', alignItems: 'flex-end', gap: 6 },
  spacer: { flexGrow: 1 },
  title: { height: 20, width: 96 },
  round: { width: 28, height: 28, borderRadius: 9999 },
  total: { height: 34, width: 120 },
  totalOf: { height: 13, width: 56 },
  totalLabel: { height: 12, width: 64 },
  segments: { display: 'flex', gap: 3 },
  segment: { height: 6, borderRadius: 3 },
  meta: { height: 11 },
  metaKey: { height: 11, width: 52 },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 },
  stat: { height: 58, borderRadius: tokens.radiusMd },
  tabs: { height: 34, borderRadius: 9999 },
  // a top section's row: the tinted band the structure pins
  groupRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 36,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 55%, ${tokens.background})`,
    paddingInline: 20,
  },
  itemRow: { display: 'flex', alignItems: 'center', gap: 8, height: 36, paddingRight: 20 },
  itemRowTall: { height: 44 },
  dot: { width: 7, height: 7, flexShrink: 0, borderRadius: 9999 },
  rowName: { height: 12 },
  rowFigure: { height: 12, width: 32 },
  chevron: { width: 10, height: 10, borderRadius: 3 },
  // one question on a phone: the bar with the way back and to its neighbours
  phoneBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: 12,
  },
  back: { height: 14, width: 64 },
  arrow: { width: 18, height: 18, borderRadius: 5 },
  paneHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingInline: { default: 28, [BELOW_DESK]: 22, [PHONE]: 16 },
    paddingTop: { default: 22, [PHONE]: 14 },
    paddingBottom: 18,
  },
  crumb: { height: 12, width: '30%' },
  heading: { height: 24, width: '45%' },
  key: { height: 36, width: 88, borderRadius: tokens.radiusMd },
  facts: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  fact: { height: 20, borderRadius: 5 },
  asideKey: { height: 38, borderRadius: 10 },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingBlock: 10,
    paddingInline: { default: 28, [BELOW_DESK]: 16 },
  },
  chips: { height: 32, borderRadius: 9999 },
  search: { height: 30, borderRadius: 8 },
  sort: { height: 30, borderRadius: 8 },
  claim: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingBlock: 14,
    paddingInline: { default: 28, [BELOW_DESK]: 16 },
  },
  claimWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 8 },
  claimLead: { height: 14 },
  claimSecond: { height: 12 },
  pill: { height: 22, width: 56, borderRadius: 6 },
  amount: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 },
  amountValue: { height: 14, width: 40 },
  amountWord: { height: 10, width: 32 },
  fill: { flexGrow: 1 },
  stepper: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingInline: 24,
  },
  step: { height: 12, width: 132 },
  aside: {
    borderLeftWidth: 1,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.divider,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 35%, ${tokens.background})`,
  },
  asideTitle: { height: 14, width: 72, marginInline: 20, marginTop: 18, marginBottom: 14 },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: 20,
    paddingBlock: 18,
  },
  label: { height: 11, width: '32%' },
  big: { height: 30, width: 96 },
  prose: { height: 12 },
  bar: { height: 6, borderRadius: 3 },
})

/** the widths a claim's lead is drawn at, down the list, so the list reads as a list */
const LEADS = ['62%', '48%', '70%']
/** the sections of the structure, and how many questions each shows while it loads */
const SECTIONS = [4, 3]
const NAMES = ['58%', '72%', '50%', '66%']

export function WorkspaceSkeleton({
  viewer,
  open,
}: {
  /** the owner keeps three figures under the total, a staff reader six */
  viewer: Viewer
  /** a question is named in the address: on a phone that is the question's own screen */
  open: boolean
}) {
  const mode = useWorkspaceMode()
  // read once, the way the workspace reads it when it mounts
  const [statsShown] = useState(() => statsShownFor(viewer))
  const phone = mode === 'phone'
  const bone = (xstyle: stylex.StyleXStyles, width?: string | number) => (
    <Skeleton
      className={stylex.props(xstyle).className}
      {...(width === undefined ? {} : { width })}
    />
  )

  const rail = (
    <div data-bone="structure" {...stylex.props(styles.column, !phone && styles.rail)}>
      <div {...stylex.props(styles.railHead)}>
        <div {...stylex.props(styles.line)}>
          {bone(styles.title)}
          <span {...stylex.props(styles.spacer)} />
          {bone(styles.round)}
        </div>
        <div {...stylex.props(styles.baseline)}>
          {bone(styles.total)}
          {bone(styles.totalOf)}
          <span {...stylex.props(styles.spacer)} />
          {bone(styles.totalLabel)}
        </div>
        <div {...stylex.props(styles.segments)}>
          {[2, 1, 1].map((grow, index) => (
            <span key={index} style={{ flexGrow: grow, flexBasis: 0 }}>
              {bone(styles.segment)}
            </span>
          ))}
        </div>
        <div {...stylex.props(styles.line)}>
          {bone(styles.meta, '40%')}
          <span {...stylex.props(styles.spacer)} />
          {bone(styles.metaKey)}
        </div>
        {statsShown && (
          <div {...stylex.props(styles.stats)} data-bone="stats">
            {Array.from({ length: viewer === 'owner' ? 3 : 6 }, (_, index) => (
              <span key={index}>{bone(styles.stat)}</span>
            ))}
          </div>
        )}
        {bone(styles.tabs)}
      </div>
      {SECTIONS.map((count, section) => (
        <div key={section}>
          <div {...stylex.props(styles.groupRow)}>
            {bone(styles.rowName, section === 0 ? '42%' : '36%')}
            <span {...stylex.props(styles.spacer)} />
            {bone(styles.rowFigure, 56)}
          </div>
          {Array.from({ length: count }, (_, index) => (
            <div
              key={index}
              {...stylex.props(styles.itemRow, phone && styles.itemRowTall)}
              style={{ paddingLeft: 36 }}
            >
              {bone(styles.dot)}
              {bone(styles.rowName, NAMES[(index + section) % NAMES.length])}
              <span {...stylex.props(styles.spacer)} />
              {index % 2 === 0 && bone(styles.rowFigure)}
              {phone && bone(styles.chevron)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )

  const question = (
    <div data-bone="question" {...stylex.props(styles.column)}>
      {phone && (
        <div {...stylex.props(styles.phoneBar)}>
          {bone(styles.back)}
          <span {...stylex.props(styles.spacer)} />
          {bone(styles.arrow)}
          {bone(styles.arrow)}
        </div>
      )}
      <div {...stylex.props(styles.paneHead)}>
        {bone(styles.crumb)}
        <div {...stylex.props(styles.line)}>
          {bone(styles.heading)}
          <span {...stylex.props(styles.spacer)} />
          {mode === 'desk' && bone(styles.key)}
        </div>
        <div {...stylex.props(styles.facts)}>
          {[52, 72, 64].map((width) => (
            <span key={width}>{bone(styles.fact, width)}</span>
          ))}
        </div>
        {mode !== 'desk' && bone(styles.asideKey)}
      </div>
      <div {...stylex.props(styles.toolbar)}>
        {bone(styles.chips, phone ? '52%' : 180)}
        <span {...stylex.props(styles.spacer)} />
        {!phone && bone(styles.search, 160)}
        {bone(styles.sort, phone ? 56 : 120)}
      </div>
      {LEADS.map((lead) => (
        <div key={lead} {...stylex.props(styles.claim)}>
          <span {...stylex.props(styles.claimWords)}>
            {bone(styles.claimLead, lead)}
            {bone(styles.claimSecond, '34%')}
          </span>
          {mode === 'desk' && bone(styles.pill)}
          <span {...stylex.props(styles.amount)}>
            {bone(styles.amountValue)}
            {bone(styles.amountWord)}
          </span>
        </div>
      ))}
      {!phone && <span {...stylex.props(styles.fill)} />}
      {!phone && (
        <div {...stylex.props(styles.stepper)}>
          {bone(styles.step)}
          {bone(styles.step)}
        </div>
      )}
    </div>
  )

  const requirements = (
    <div data-bone="requirements" {...stylex.props(styles.column, styles.aside)}>
      {bone(styles.asideTitle)}
      <div {...stylex.props(styles.block)}>
        {bone(styles.big)}
        {bone(styles.prose, '46%')}
        {bone(styles.label)}
        {bone(styles.bar)}
      </div>
      {['56%', '80%'].map((width) => (
        <div key={width} {...stylex.props(styles.block)}>
          {bone(styles.label)}
          {bone(styles.prose, width)}
        </div>
      ))}
    </div>
  )

  return (
    <div
      aria-hidden
      data-testid="workspace-skeleton"
      data-mode={mode}
      data-viewer={viewer}
      {...stylex.props(styles.root, shapes[mode])}
    >
      {phone ? (open ? question : rail) : rail}
      {!phone && question}
      {mode === 'desk' && requirements}
    </div>
  )
}

const shapes: Record<WorkspaceMode, stylex.StyleXStyles> = {
  desk: styles.desk,
  tablet: styles.tablet,
  phone: styles.phone,
}
