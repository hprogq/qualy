import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import {
  useApi,
  useApiQuery,
  usePageQueryState,
  usePageQueryUpdate,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { RefreshCwIcon, TableOfContentsIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Appear, Glide, Sift, SiftRow, Swap } from '@qualy/ui/reveal'
import { Button } from '@qualy/ui/button'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { Segmented } from '@qualy/ui/screen'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { entryRefusalMessage } from './refusals.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { useRestOfTheScroller } from '../rest-of-the-scroller.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AppealDialog } from './AppealDialog.tsx'
import { SupplementAnswerDialog } from './SupplementAnswerDialog.tsx'
import { EntryDialog } from './EntryDialog.tsx'
import { EntrySheet } from './EntrySheet.tsx'
import { Paper } from './Paper.tsx'
import { ROW_TAG, standingRows, type RowTag, type Standing, type StructureRow } from './standing.ts'
import { trimAmount, type EntryDto, type FilingGateDto, type ItemDto } from './model.ts'

// One's own filings: the round's structure down the left, and whatever is
// selected in it opened on the right.
//
// The structure is one list rather than three screens. A group and a question
// are both rows in it, because a participant reading down what a round asks
// of them does not think of the groups as a different kind of place - they
// think "what is in here, and what have I done about it". Selecting a group
// answers the first, selecting a question answers the second.

const md = '@media (min-width: 768px)'
const lg = '@media (min-width: 1024px)'
const xl = '@media (min-width: 1280px)'
const belowSm = '@media (max-width: 639.98px)'
const belowLg = '@media (max-width: 1023.98px)'

const spin = stylex.keyframes({
  '100%': { transform: 'rotate(360deg)' },
})

const styles = stylex.create({
  switchGrow: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  switchOption: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  fill: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  emptyNote: {
    padding: 24,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  // the structure as its own column, the paper as the page: both panes
  // scroll inside themselves where they stand side by side; narrow, the
  // paper flows in the page and the structure folds into a drawer
  pageWrap: {
    position: 'relative',
    display: 'flex',
    minHeight: {
      default: 384,
      [lg]: 0,
    },
    flexDirection: 'column',
    flexGrow: {
      default: null,
      [lg]: 1,
    },
    flexShrink: {
      default: null,
      [lg]: 1,
    },
    flexBasis: {
      default: null,
      [lg]: '0%',
    },
  },
  panes: {
    display: 'grid',
    minHeight: {
      default: null,
      [lg]: 0,
    },
    flexGrow: {
      default: null,
      [lg]: 1,
    },
    flexShrink: {
      default: null,
      [lg]: 1,
    },
    flexBasis: {
      default: null,
      [lg]: '0%',
    },
    gridTemplateColumns: {
      default: null,
      [lg]: '17rem minmax(0, 1fr)',
      [xl]: '20rem minmax(0, 1fr)',
    },
    gridTemplateRows: {
      default: null,
      [lg]: 'minmax(0, 1fr)',
    },
  },
  paperPane: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    minHeight: {
      default: null,
      [lg]: 0,
    },
    borderLeftWidth: {
      default: 0,
      [lg]: 1,
    },
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
  },
  headSticky: {
    zIndex: 10,
    position: {
      default: null,
      [belowLg]: 'sticky',
    },
    top: {
      default: null,
      [belowLg]: 0,
    },
  },
  headSurface: {
    backgroundColor: tokens.background,
  },
  // phone: the name gets a line, the controls get the next
  narrowHead: {
    display: {
      default: 'flex',
      [md]: 'none',
    },
    flexDirection: 'column',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  narrowTitleRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 12,
  },
  narrowTitleCol: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  narrowTitle: {
    fontSize: 17,
    lineHeight: 1.25,
    fontWeight: 600,
  },
  narrowMeta: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  countSeat: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'baseline',
    gap: 6,
    whiteSpace: 'nowrap',
  },
  countLabel: {
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  countValue: {
    fontSize: 20,
    lineHeight: 1,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  narrowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  shrinkNone: {
    flexShrink: 0,
  },
  nums: {
    fontVariantNumeric: 'tabular-nums',
  },
  // tablet up: one row; the structure key leaves once the rail stands
  // beside the paper
  wideHead: {
    display: {
      default: 'none',
      [md]: 'block',
    },
    height: 48,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  wideHeadInner: {
    marginInline: 'auto',
    display: 'flex',
    height: '100%',
    width: '100%',
    maxWidth: '72rem',
    alignItems: 'center',
    gap: 12,
    paddingInline: {
      default: 16,
      [lg]: 24,
    },
  },
  wideTitle: {
    flexShrink: 0,
    fontSize: 16,
    fontWeight: 600,
  },
  headRule: {
    height: 14,
    width: 1,
    flexShrink: 0,
    backgroundColor: tokens.border,
  },
  wideCountValue: {
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  countLabelXs: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  spinning: {
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
  },
  statChip: {
    display: {
      default: 'none',
      '@media (min-width: 640px)': 'inline-flex',
    },
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 10,
    paddingBlock: 6,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  statPair: {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 4,
  },
  statNum: {
    fontWeight: 600,
    color: tokens.foreground,
    fontVariantNumeric: 'tabular-nums',
  },
  statNumAlert: {
    color: tokens.danger,
  },
  // An overlay, not a block in the flow: the strip appearing must not
  // change the sticky header's height - every appearance shifted the whole
  // paper under the reader and resized the scrollbar thumb with it. The
  // spy's READING_EDGE already budgets the strip's 36px whether or not it
  // is up, so hanging it under the toolbar costs the arithmetic nothing.
  stripSeat: {
    display: {
      default: 'block',
      [lg]: 'none',
    },
    position: 'absolute',
    insetInline: 0,
    top: '100%',
  },
  strip: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.background} 95%, transparent)`,
    backdropFilter: 'blur(4px)',
  },
  stripInner: {
    marginInline: 'auto',
    display: 'flex',
    height: 36,
    width: '100%',
    maxWidth: '72rem',
    alignItems: 'center',
    gap: 10,
    paddingInline: 16,
  },
  stripNo: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  stripName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 600,
  },
  stripLedger: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  paneScroller: {
    position: 'relative',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  swapSeat: {
    width: '100%',
  },
  dragHandle: {
    marginInline: 'auto',
    marginTop: 10,
    marginBottom: 4,
    height: 4,
    width: 36,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
  },
  // ---- skeleton: the page it is about to become, greyed ----
  skBarWide: {
    display: {
      default: 'none',
      [md]: 'flex',
    },
    height: 48,
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: {
      default: 16,
      [lg]: 24,
    },
  },
  skLineTitle: {
    height: 20,
    width: 80,
  },
  skLineName: {
    height: 20,
    width: 96,
  },
  skLineTabs: {
    height: 28,
    width: 176,
    borderRadius: tokens.radiusLg,
  },
  skBarNarrow: {
    display: {
      default: 'flex',
      [md]: 'none',
    },
    flexDirection: 'column',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  skNarrowTitleRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 12,
  },
  skNarrowTitleCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  skLineMeta: {
    height: 14,
    width: 144,
  },
  skLineCount: {
    height: 24,
    width: 64,
  },
  skNarrowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  skLineFilter: {
    height: 36,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    borderRadius: tokens.radiusLg,
  },
  skLineKey: {
    height: 32,
    width: 96,
    borderRadius: tokens.radiusLg,
  },
  skGrid: {
    display: 'grid',
    minHeight: {
      default: null,
      [lg]: 0,
    },
    flexGrow: {
      default: null,
      [lg]: 1,
    },
    flexShrink: {
      default: null,
      [lg]: 1,
    },
    flexBasis: {
      default: null,
      [lg]: '0%',
    },
    gridTemplateColumns: {
      default: null,
      [lg]: '17rem minmax(0, 1fr)',
      [xl]: '20rem minmax(0, 1fr)',
    },
  },
  skRail: {
    display: {
      default: 'none',
      [lg]: 'flex',
    },
    flexDirection: 'column',
    gap: 16,
    paddingInline: 16,
    paddingBlock: 16,
  },
  skTree: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  skTreeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  skDotSquare: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: 2,
  },
  skDotRound: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: '9999px',
  },
  skTreeLine: {
    height: 16,
  },
  skTreeLedger: {
    marginLeft: 'auto',
    height: 14,
    width: 48,
    flexShrink: 0,
  },
  skMain: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 24,
    paddingInline: {
      default: 16,
      [lg]: 24,
    },
    paddingBlock: 20,
    borderLeftWidth: {
      default: 0,
      [lg]: 1,
    },
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
  },
  skCard: {
    height: 96,
    width: '100%',
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
  },
  skBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  skBlockTitle: {
    height: 20,
    width: 176,
  },
  skBlockMeta: {
    height: 14,
    width: 256,
  },
  skBlockBody: {
    marginTop: 4,
    height: 64,
    width: '100%',
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
  },
  // ---- the structure rail and its drawer twin ----
  railRoot: {
    position: 'relative',
    display: {
      default: 'none',
      [lg]: 'flex',
    },
    minWidth: 0,
    flexDirection: 'column',
    minHeight: {
      default: null,
      [lg]: 0,
    },
  },
  railHead: {
    display: 'flex',
    height: 48,
    flexShrink: 0,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 16,
  },
  railTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  railBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 12,
  },
  railTop: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
  },
  railCount: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  // the round in one card over the list of it: its name, what it has
  // granted, and how much paper there is
  summaryCard: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 8,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    paddingInline: 12,
    paddingBlock: 10,
  },
  sumRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  sumName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontWeight: 600,
  },
  sumValue: {
    flexShrink: 0,
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  sumValueZero: {
    color: tokens.mutedForeground,
  },
  sumUnit: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  meter: {
    display: 'block',
    height: 3,
    overflow: 'hidden',
    borderRadius: '9999px',
    backgroundColor: tokens.border,
  },
  meterFill: {
    display: 'block',
    height: '100%',
    borderRadius: '9999px',
    backgroundColor: tokens.foreground,
  },
  sumFoot: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  noWrap: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  treeEmpty: {
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 16,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  tree: {
    position: 'relative',
    isolation: 'isolate',
    display: 'flex',
    minHeight: 0,
    flexDirection: 'column',
  },
  glideMark: {
    zIndex: -1,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
  },
  row: {
    position: 'relative',
    isolation: 'isolate',
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 8,
    borderRadius: tokens.radiusLg,
    paddingBlock: 6,
    paddingRight: 10,
    textAlign: 'left',
    transitionProperty: 'color, background-color',
  },
  rowHoverable: {
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  rowTopGap: {
    marginTop: 4,
  },
  // withdrawn: still listed, because what was filed under it is still
  // there to read, but it takes less room and wears the fact on its name
  rowGone: {
    paddingBlock: 4,
  },
  // the joints of the tree: an elbow into this row, and the sibling line
  // running past it while siblings remain
  elbow: {
    position: 'absolute',
    top: 0,
    height: '50%',
    width: 10,
    borderBottomLeftRadius: 7,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    borderLeftWidth: 1,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
  },
  siblingLine: {
    position: 'absolute',
    insetBlock: 0,
    width: 1,
    backgroundColor: tokens.border,
  },
  downLine: {
    position: 'absolute',
    bottom: 0,
    height: '50%',
    width: 1,
    backgroundColor: tokens.border,
  },
  groupSquare: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: 2,
    backgroundColor: tokens.border,
  },
  // unread paints over everything: something here changed and its owner
  // has not seen it
  unreadDot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.danger,
  },
  // the row's own word as a colour, never an alarm: amber waits on the
  // reader, verdict inks say how it ended, hollow means nothing is
  // claimed here yet
  dot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: '9999px',
  },
  dotHollow: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
  },
  dotOpen: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
  },
  dotWaits: {
    backgroundColor: tokens.warning,
  },
  dotDraft: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  dotInReview: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  dotRejected: {
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 80%, transparent)`,
  },
  dotPartial: {
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 60%, transparent)`,
  },
  dotApproved: {
    backgroundColor: tokens.success,
  },
  dotQuiet: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  rowName: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  rowNameStrong: {
    fontWeight: 600,
  },
  rowNameGone: {
    fontSize: 12,
    fontWeight: 400,
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
    textDecorationColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  tagWord: {
    maxWidth: 96,
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  tagWordUrgent: {
    fontWeight: 500,
    color: tokens.warningForeground,
  },
  // the group's own ledger line: how much, of how much
  ledgerCol: {
    display: 'flex',
    width: 64,
    flexShrink: 0,
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
  },
  ledgerLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 2,
    whiteSpace: 'nowrap',
  },
  ledgerGot: {
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  ledgerGotZero: {
    color: tokens.mutedForeground,
  },
  ledgerCap: {
    fontSize: 10,
    color: tokens.mutedForeground,
  },
  miniMeter: {
    display: 'block',
    height: 3,
    width: '100%',
    overflow: 'hidden',
    borderRadius: '9999px',
    backgroundColor: tokens.border,
  },
  itemWorth: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  sheetRoot: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  sheetHead: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingInline: 16,
    paddingBottom: 10,
  },
  sheetTitle: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: 600,
  },
  sheetMeta: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  sheetBody: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    paddingInline: 8,
    paddingTop: 6,
    paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
  },
})

/**
 * The dot beside each question, coloured by the row's own word (§32.72,
 * amended): amber where the round waits on the reader, neutral for the
 * reader's own states and for waiting on others, verdict colours for how
 * it ended, hollow where nothing has been claimed. Unread stays a separate
 * signal and paints over all of these in red.
 */
const DOT: Record<RowTag, stylex.StyleXStyles> = {
  voided: styles.dotHollow,
  supplement: styles.dotWaits,
  needs_revision: styles.dotWaits,
  draft: styles.dotDraft,
  in_review: styles.dotInReview,
  rejected: styles.dotRejected,
  partial: styles.dotPartial,
  approved: styles.dotApproved,
  recorded: styles.dotQuiet,
  granted: styles.dotQuiet,
  open: styles.dotOpen,
}

/**
 * Whether the two panes are standing side by side.
 *
 * The same query the layout switches on, asked in javascript for the one
 * thing css cannot decide: what pressing back should mean. Narrow, a layer
 * is somewhere the reader went and back is how anybody leaves it; wide, the
 * layers are furniture beside a list, and clicking ten questions must not
 * cost ten presses of back to undo.
 */
function useSideBySide(): boolean {
  const [beside, setBeside] = useState(true)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 64rem)')
    const read = () => setBeside(query.matches)
    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])
  return beside
}

/**
 * One piece of this screen that lives in the address.
 *
 * Every layer of this page - which question is open, whose account is being
 * read, which claim is being written - is a query parameter rather than
 * component state, so a reload keeps it, a link carries it, and the phone's
 * back key walks out of it one layer at a time instead of leaving the page.
 * Closing sets it to '' and the parameter goes: an empty one left behind
 * would open the layer again on the next reload.
 */
function useLayer(key: string): [string, (next: string) => void] {
  const beside = useSideBySide()
  return usePageQueryState(key, '', { history: beside ? 'replace' : 'push' })
}

export default function MyEntriesPage() {
  const { format } = useI18n()
  const [selected] = useLayer('open')
  return (
    // no band: the paper carries its own toolbar, with the page's name and
    // numbers on it, and fills whatever the shell gives it
    <BatchScreen title={format(m.myEntriesTab)} size="full" chrome="none">
      {(batch) => (
        <Body
          batchId={batch.id}
          batchName={batch.name}
          materialRange={batch.materialRange}
          selected={selected}
        />
      )}
    </BatchScreen>
  )
}

/**
 * The line a row has to reach before it counts as the one being read: clear
 * of the band strip pinned under the toolbar, which is all that stands over
 * the paper - 36px of strip and a little air.
 */
const READING_EDGE = 44

/**
 * The paper's own scroller, where it has one.
 *
 * Side by side the paper scrolls inside itself; narrow it is part of the
 * page and the page's scroller is the right one to move.
 */
const paneViewport = (pane: HTMLElement | null): HTMLElement | null => {
  const found = pane?.querySelector('[data-slot="scroll-area-viewport"]')
  return found instanceof HTMLElement ? found : null
}

/** the nearest scroller the paper flows in, when it has none of its own */
const pageScroller = (pane: HTMLElement | null): HTMLElement | null => {
  for (let at = pane?.parentElement ?? null; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at)
    if (overflowY === 'auto' || overflowY === 'scroll') return at
  }
  return null
}

/**
 * Bring a row under the reader, reporting whether it could and where the
 * scroll will come to rest.
 *
 * Arithmetic rather than `scrollIntoView`, which scrolls every scrollable
 * ancestor it can find: in a pane that scrolls inside itself that means the
 * shell moves too, taking the toolbar and the rail off the top of the window
 * with it. Narrow, the toolbar rides inside the scroller as a sticky block,
 * so its height joins what the row has to clear; the strip's 36px are
 * counted whether or not the strip is up right now, because it will be by
 * the time the scroll ends.
 */
const bring = (
  pane: HTMLElement | null,
  head: HTMLElement | null,
  id: string,
  how: 'smooth' | 'instant',
): { moved: boolean; top: number | null } => {
  const row = pane?.querySelector(`[data-paper-row="${id}"]`)
  if (!(row instanceof HTMLElement)) return { moved: false, top: null }
  const inPane = paneViewport(pane)
  const viewport = inPane ?? pageScroller(pane)
  if (viewport === null) return { moved: false, top: null }
  // a band card wants the top of the reading area; a question wants to
  // clear the strip that names the band it is in
  const sticky = inPane !== null ? 0 : (head?.offsetHeight ?? 0)
  const clear = sticky + (row.hasAttribute('data-paper-band') ? 0 : READING_EDGE)
  const at =
    viewport.scrollTop + row.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  // where it will come to rest: the end of the paper stops short of what a
  // row near the bottom asks for, and the mark has to know that
  const top = Math.min(
    Math.max(0, at - clear),
    Math.max(0, viewport.scrollHeight - viewport.clientHeight),
  )
  viewport.scrollTo({ top, behavior: how })
  return { moved: true, top }
}

function Body({
  batchId,
  batchName,
  materialRange,
  selected,
}: {
  batchId: string
  batchName: string
  materialRange: { start: string; end: string }
  /** which row of the structure is open, by id; '' is the first one that is */
  selected: string
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const queryClient = useQueryClient()
  // Wake-ups from the server, mapped to the exact reads they stale. The
  // paper redraws itself from fresh answers; nothing here touches the form
  // a person may be filling - the open dialog holds its own snapshot and
  // its own stale protocol.
  const { live } = useBatchLive(batchId, (kind) => {
    const stale = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key })
    switch (kind) {
      // a phase switch may have flipped every capability on this screen -
      // the paper's gates, the claims' buttons, the batch's own standing -
      // so it re-reads the lot, exactly like a fresh connection
      case 'sync':
      case 'phase-changed':
        stale(query.assessment.key())
        return
      case 'entries-changed':
        stale(query.assessment.listMyEntries.key({ params: { batchId }, query: {} }))
        stale(query.assessment.listAwaitingSupplements.key({ query: { batchId } }))
        return
      case 'item-changed':
        stale(query.assessment.listItems.key({ params: { batchId } }))
        stale(query.assessment.listScoreGroups.key({ params: { batchId } }))
        return
      case 'result-changed':
        stale(query.assessment.getMyResult.key({ params: { batchId } }))
        return
      default:
        return
    }
  })

  const items = useQuery({
    ...query.assessment.listItems.queryOptions({ params: { batchId } }),
    refetchInterval: live ? 120_000 : 30_000,
  })
  const groups = useQuery({
    ...query.assessment.listScoreGroups.queryOptions({ params: { batchId } }),
    refetchInterval: live ? 120_000 : 30_000,
  })
  // what the round has already granted, so a group can say where it stands.
  // It is part of the first paint like the rest: an amount that arrives a
  // moment later moves every card underneath it out from under the cursor
  const standing = useQuery({
    ...query.assessment.getMyResult.queryOptions({ params: { batchId } }),
    refetchInterval: live ? 60_000 : 30_000,
  })
  const mine = useQuery({
    ...query.assessment.listMyEntries.queryOptions({ params: { batchId }, query: {} }),
    refetchInterval: live ? 60_000 : 30_000,
  })
  // 'new' is a claim about to exist on whichever question is open; anything
  // else names the claim being rewritten. The question itself is never
  // repeated here - `open` already says which one this is about.
  const [filing, setFiling] = useLayer('entry')
  const [detail, setDetail] = useLayer('detail')
  // narrow only: the structure folded into a drawer the toolbar opens
  const [structure, setStructure] = useLayer('rail')
  // moving two layers at once - open this question AND start a claim on
  // it - must be one address write: two writes from one click race on the
  // router's snapshot and the second silently drops the first, which is a
  // filing dialog that opens on the wrong question or not at all
  const beside = useSideBySide()
  const updateQuery = usePageQueryUpdate()
  const openAndFile = (itemId: string, entryId: string) =>
    updateQuery({ open: itemId, entry: entryId }, { history: beside ? 'replace' : 'push' })
  const [appealing, setAppealing] = useState<EntryDto | null>(null)
  const lingeringAppeal = useLingering(appealing)
  const [answering, setAnswering] = useState<EntryDto | null>(null)
  const lingeringAnswer = useLingering(answering)

  const entriesByItem = useMemo(() => {
    const grouped = new Map<string, EntryDto[]>()
    for (const entry of (mine.data?.entries ?? []) as readonly EntryDto[]) {
      const bucket = grouped.get(entry.itemId)
      if (bucket === undefined) grouped.set(entry.itemId, [entry])
      else bucket.push(entry)
    }
    return grouped
  }, [mine.data])

  // the phase gate's word on filing into each question, by item
  const filingByItem = useMemo(
    () =>
      new Map(
        ((mine.data?.filing ?? []) as readonly FilingGateDto[]).map((gate) => [gate.itemId, gate]),
      ),
    [mine.data],
  )

  // the refresh key's one press: every read this screen stands on, again -
  // the batch's own standing included, which carries the current phase
  const refetchAll = () => {
    void items.refetch()
    void groups.refetch()
    void mine.refetch()
    void standing.refetch()
    void queryClient.invalidateQueries({
      queryKey: query.assessment.getBatch.key({ params: { batchId } }),
    })
  }
  const anyFetching =
    items.isFetching || groups.isFetching || mine.isFetching || standing.isFetching

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  }

  /**
   * A declaration filed in its one press: created and handed on in the same
   * breath. The dialog never opens - there is nothing in it to fill - and
   * the toast says what the press amounted to, which depends on whether the
   * question reviews its claims at all.
   */
  const declare = useMutation({
    mutationFn: async (input: { itemId: string }) => {
      if (mine.data === undefined) throw new Error('roster not loaded')
      // a declaration has no fields, but its worth and its route are still
      // the question's current version - the press names what it saw
      const seen = (items.data?.items ?? []).find((one) => one.id === input.itemId)?.currentRevision
        ?.id
      const created = await run(
        api.assessment.createEntry({
          payload: {
            itemId: input.itemId,
            participantId: mine.data.participantId,
            payload: {},
            ...(seen === undefined ? {} : { expectedItemRevisionId: seen }),
          },
        }),
      )
      const sent = await run(
        api.assessment.setEntryStatus({
          params: { entryId: created.entry.id },
          payload: {
            status: 'in_review',
            ...(seen === undefined ? {} : { expectedItemRevisionId: seen }),
          },
        }),
      )
      return sent.entry
    },
    onSuccess: (entry) => {
      toast.success(
        format(entry.status === 'approved' ? m.entryDeclaredCounted : m.entryDeclaredFiled),
      )
      refresh()
    },
    onError: (error: unknown) => {
      const refusal = entryRefusalMessage(error)
      toast.error(refusal === null ? formatError(error) : format(refusal))
    },
  })

  const setStatus = useMutation({
    mutationFn: (input: {
      entryId: string
      status: 'in_review' | 'draft' | 'voided'
      expectedItemRevisionId?: string
    }) =>
      run(
        api.assessment.setEntryStatus({
          params: { entryId: input.entryId },
          payload: {
            status: input.status,
            ...(input.expectedItemRevisionId === undefined
              ? {}
              : { expectedItemRevisionId: input.expectedItemRevisionId }),
          },
        }),
      ),
    // said out loud, per act: three different things just happened to the
    // claim, and a silently refreshed list reports none of them
    onSuccess: (_result, input) => {
      toast.success(
        format(
          input.status === 'in_review'
            ? m.entrySubmittedToast
            : input.status === 'draft'
              ? m.entryWithdrawnToast
              : m.entryAbandonedToast,
        ),
      )
      refresh()
    },
    onError: (error: unknown) => {
      const refusal = entryRefusalMessage(error)
      toast.error(refusal === null ? formatError(error) : format(refusal))
    },
  })

  // Every question of the round this person takes part in, whoever fills it
  // in. One the school records is still theirs to read - it is how their
  // round adds up, and "somebody else writes this one" is a fact about the
  // question, not a reason to hide it. A question still being composed is
  // the only one nobody outside the paper can see.
  const visible = useMemo(
    () =>
      ((items.data?.items ?? []) as readonly ItemDto[]).filter((item) => item.status !== 'draft'),
    [items.data],
  )

  const unreadItems = useMemo(
    () => new Set(mine.data?.attention?.unreadItemIds ?? []),
    [mine.data?.attention?.unreadItemIds],
  )
  const rows = useMemo(
    () =>
      standingRows({
        groups: groups.data?.groups ?? [],
        items: visible,
        entriesByItem,
        standing: (standing.data ?? null) as Standing | null,
        unreadItems,
      }),
    [groups.data, visible, entriesByItem, standing.data, unreadItems],
  )

  // Looking silences the dot (§32.72). "Looking" is a settled pause on the
  // question - the scroll spy's row, held for a moment - or opening one of
  // its claims outright; a fast scroll past ten questions marks nothing.
  // The cache is corrected locally: a look is not a business change, so no
  // refetch and no announcement ride on it.
  const listKey = query.assessment.listMyEntries.key({ params: { batchId }, query: {} })
  const markRead = useMutation({
    mutationFn: (itemId: string) =>
      run(api.assessment.markMyEntryRead({ params: { batchId, itemId } })),
    onSuccess: (_result, itemId) => {
      queryClient.setQueryData(
        listKey,
        (old: { attention: { unreadItemIds: readonly string[] } } | undefined) =>
          old === undefined
            ? old
            : {
                ...old,
                attention: {
                  unreadItemIds: old.attention.unreadItemIds.filter((id) => id !== itemId),
                },
              },
      )
    },
  })
  const lookAt = (itemId: string | null | undefined) => {
    if (itemId != null && unreadItems.has(itemId)) markRead.mutate(itemId)
  }
  // opening a question outright is a look, no pause required
  useEffect(() => {
    const row = rows.find((one) => one.id === selected)
    if (row?.kind === 'item') lookAt(row.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows])

  // the address names a row; before it names one, the first question there is
  // to answer is a better place to land than an empty pane
  const fallback = rows.find((row) => row.kind === 'item') ?? rows[0]
  const open = rows.find((row) => row.id === selected) ?? fallback ?? null

  // The claim being written, resolved from the address rather than carried
  // in state: 'new' is one about to exist on the open question, anything
  // else is one of that question's own claims by id. A parameter naming a
  // claim that is not there any more simply opens nothing.
  const writing =
    filing === '' || open?.kind !== 'item' || open.item === undefined
      ? null
      : {
          item: open.item,
          trail: open.trail,
          entry:
            filing === 'new'
              ? null
              : ((entriesByItem.get(open.id) ?? []).find((one) => one.id === filing) ?? null),
        }
  const lingeringFiling = useLingering(writing)
  // the claim the drawer is holding, resolved from the address: a parameter
  // naming a claim that is gone simply opens nothing
  const detailed = (() => {
    if (detail === '') return null
    for (const [itemId, list] of entriesByItem) {
      const found = list.find((one) => one.id === detail)
      if (found !== undefined) {
        const itemRow = rows.find((one) => one.id === itemId)
        if (itemRow?.item !== undefined) {
          return { entry: found, item: itemRow.item, trail: itemRow.trail }
        }
      }
    }
    return null
  })()
  const lingeringDetail = useLingering(detailed)

  // The rail follows the scroll: whichever paper row is under the toolbar
  // is the one the rail highlights, with the same mark a click leaves. The
  // address is written only by clicks - a scroll is reading, not going
  // somewhere, and a hundred history entries per page would prove it.
  // Held as state, not a ref: the paper mounts on its own schedule - the
  // rows exist for the moment between the questions arriving and the last
  // read the page waits for - and everything that watches the paper has to
  // start watching when it appears, not when the rows change.
  const [paper, setPaper] = useState<HTMLElement | null>(null)
  // the toolbar block that rides sticky inside the narrow scroller; its
  // height is what a scroll target has to clear there
  const [head, setHead] = useState<HTMLElement | null>(null)
  const [passing, setPassing] = useState('')
  // which band's card has gone above the toolbar, and so wants naming in the
  // strip; a band whose card is still on screen names itself
  const [passedBand, setPassedBand] = useState('')
  // While a click's scroll is in flight, the spy would call out every row it
  // passes and the rail's mark would strobe through all of them. The
  // steering lock holds the mark on the destination until the scroll gets
  // there (or gives up).
  const steering = useRef<{ id: string; top: number; until: number } | null>(null)
  useEffect(() => {
    const viewport = paneViewport(paper) ?? pageScroller(paper)
    if (viewport === null) return
    let frame = 0
    const read = () => {
      frame = 0
      const port = viewport.getBoundingClientRect()
      // Where the reading starts: under the sticky toolbar where the paper
      // flows in the page, at the pane's own top where it scrolls inside
      // itself - the toolbar stands outside the pane there, so its bottom
      // IS the pane's top. One base for both shapes.
      const base =
        head === null ? port.top : Math.max(port.top, head.getBoundingClientRect().bottom)
      // past the pinned band strip as well: what counts as "under the
      // reader" is what stands clear of everything pinned above it
      const edge = base + READING_EDGE
      // The tail of the paper can never reach that line: a last band of two
      // questions stops the scroll long before its rows climb that high, and
      // a rail that never lights them is a rail that lies. At the end of the
      // scroll the reader is reading whatever the end shows, so the last row
      // on screen is the one being read.
      const stopped = viewport.scrollTop >= viewport.scrollHeight - viewport.clientHeight - 2
      let current = ''
      for (const el of viewport.querySelectorAll('[data-paper-row]')) {
        const box = el.getBoundingClientRect()
        if (box.top <= edge || (stopped && box.top < port.bottom)) {
          current = el.getAttribute('data-paper-row') ?? ''
        } else break
      }
      // the strip is geometry, not inference: it names the band whose own
      // card has left the top of the pane, so it never repeats a card the
      // reader can still see
      let band = ''
      for (const el of viewport.querySelectorAll('[data-paper-band]')) {
        if (el.getBoundingClientRect().bottom <= base + 1) {
          band = el.getAttribute('data-paper-band') ?? ''
        } else break
      }
      setPassedBand(band)
      const held = steering.current
      if (held !== null) {
        // parked where the click put it: the reader has not moved since, so
        // the row they asked for is still the row they are reading - true
        // as well of a row near the end, which the scroll stops short of
        // bringing all the way up
        if (Math.abs(viewport.scrollTop - held.top) <= 4) {
          setPassing(held.id)
          return
        }
        // still on its way there
        if (Date.now() <= held.until) return
        steering.current = null
      }
      setPassing(current)
    }
    const on = () => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    read()
    viewport.addEventListener('scroll', on, { passive: true })
    return () => {
      viewport.removeEventListener('scroll', on)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
    // the scroller itself is swapped out when the two panes stop standing
    // side by side, and the new one needs its own listener
  }, [paper, head, beside, rows.length])

  /**
   * A rail click: name it in the address, then bring it under the reader.
   * One write moves both layers - the chosen row lands in `open` and the
   * drawer's own layer clears - because two writes from one click race on
   * the router's snapshot and the second silently drops the first.
   */
  const goTo = (id: string) => {
    updateQuery({ open: id, rail: '' }, { history: beside ? 'replace' : 'push' })
    setPassing(id)
    const { top } = bring(paper, head, id, 'smooth')
    steering.current = top === null ? null : { id, top, until: Date.now() + 1500 }
  }
  // The row the page ARRIVED at, jumped to once and never again: a row the
  // reader names later by clicking the rail is theirs to scroll to smoothly,
  // and an instant jump racing that scroll is what makes the first click of
  // a session snap while every later one glides. The jump waits for its row
  // to exist, too - the groups arrive before the questions do, and a landing
  // spent on the commit in between scrolls to nothing at all.
  const arrivedAt = useRef(selected)
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || arrivedAt.current === '') return
    // side by side the paper scrolls inside itself, and until that scroller
    // exists the only thing a jump can move is the shell around it
    if (beside && paneViewport(paper) === null) return
    landed.current = bring(paper, head, arrivedAt.current, 'instant').moved
    // reading the address is not a scroll; the spy fills in from here
  }, [paper, head, beside, rows.length])

  // the depth the bands sit at: one down when a single root group holds the
  // whole paper, since the summary card stands in for that one
  const bandDepth =
    rows.length > 0 &&
    rows[0]!.kind === 'group' &&
    rows.filter((row) => row.depth === 0).length === 1
      ? 1
      : 0
  const isBand = (id: string): boolean => {
    const at = rows.find((row) => row.id === id)
    return at !== undefined && at.kind === 'group' && at.depth === bandDepth
  }
  // The band named by the strip pinned under the toolbar: the one whose own
  // card has gone off the top, because a strip repeating a card still on
  // screen names the place twice. A click that sent the reader to a band
  // whose card is on screen quiets it too - naming the band before the one
  // they asked for reads as a wrong answer.
  const currentBand =
    passedBand === '' || (passing !== passedBand && isBand(passing))
      ? null
      : (rows.find((row) => row.id === passedBand) ?? null)
  const bandNoOf = (band: StructureRow): string => {
    const tops = rows.filter((row) => row.kind === 'group' && row.depth === bandDepth)
    return String(tops.findIndex((row) => row.id === band.id) + 1).padStart(2, '0')
  }

  // What the rail marks is what the reader is looking at, and only the spy
  // knows that. Falling back to the first question meant the mark opened on
  // question one and then slid up to the band the reader was actually on,
  // which reads as the page correcting itself; on a phone, where the paper
  // scrolls as the page, the drawer opened marking a question nobody had
  // scrolled to. Nothing is marked until the paper has been read once - the
  // spy answers on mount, so that is one frame, not a wait.
  const marked = passing !== '' ? passing : selected !== '' ? selected : null
  useEffect(() => {
    const row = rows.find((one) => one.id === marked)
    if (row?.kind !== 'item' || !row.unread) return
    const timer = setTimeout(() => lookAt(row.id), 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marked, rows])

  const [paperView, setPaperView] = useState<'all' | 'todo'>('all')
  const questionCount = rows.filter((row) => row.kind === 'item').length
  const todoCount = rows.filter((row) => row.todo).length
  const bandCount = rows.filter((row) => row.kind === 'group' && row.depth === bandDepth).length
  const entries = (mine.data?.entries ?? []) as readonly EntryDto[]
  const pendingCount = entries.filter((entry) => entry.status === 'in_review').length
  const draftCount = entries.filter((entry) => entry.status === 'draft').length
  const backCount = entries.filter((entry) => entry.status === 'needs_revision').length

  return (
    <AsyncSection
      pending={items.isPending || mine.isPending || groups.isPending || standing.isPending}
      error={
        items.error
          ? formatError(items.error)
          : groups.error
            ? formatError(groups.error)
            : mine.error
              ? formatError(mine.error)
              : null
      }
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void items.refetch()
        void groups.refetch()
        void mine.refetch()
        void standing.refetch()
      }}
      skeleton={
        // the page it is about to become, greyed: the toolbar line, the
        // structure rail with its tree, the paper with its display card
        // and question blocks - and on a phone only the paper, because
        // the structure lives in a drawer there
        <div {...stylex.props(styles.fill)}>
          <div {...stylex.props(styles.skBarWide)}>
            <Skeleton className={stylex.props(styles.skLineTitle).className} />
            <span aria-hidden {...stylex.props(styles.headRule)} />
            <Skeleton className={stylex.props(styles.skLineName).className} />
            <span {...stylex.props(styles.spacer)} />
            <Skeleton className={stylex.props(styles.skLineTabs).className} />
          </div>
          <div {...stylex.props(styles.skBarNarrow)}>
            <div {...stylex.props(styles.skNarrowTitleRow)}>
              <div {...stylex.props(styles.skNarrowTitleCol)}>
                <Skeleton className={stylex.props(styles.skLineTitle).className} />
                <Skeleton className={stylex.props(styles.skLineMeta).className} />
              </div>
              <span {...stylex.props(styles.spacer)} />
              <Skeleton className={stylex.props(styles.skLineCount).className} />
            </div>
            <div {...stylex.props(styles.skNarrowControls)}>
              <Skeleton className={stylex.props(styles.skLineFilter).className} />
              <Skeleton className={stylex.props(styles.skLineKey).className} />
            </div>
          </div>
          <div {...stylex.props(styles.skGrid)}>
            <div {...stylex.props(styles.skRail)}>
              <Skeleton className={stylex.props(styles.skLineKey).className} />
              <div {...stylex.props(styles.skTree)}>
                {(
                  [
                    ['group', '96px', 0],
                    ['item', '60%', 1],
                    ['item', '40%', 1],
                    ['group', '80px', 0],
                    ['item', '50%', 1],
                    ['item', '75%', 1],
                    ['item', '40%', 1],
                  ] as const
                ).map(([kind, width, depth], index) => (
                  <div
                    key={index}
                    {...stylex.props(styles.skTreeRow)}
                    style={{ paddingLeft: `${String(depth * 14)}px` }}
                  >
                    <Skeleton
                      className={
                        stylex.props(kind === 'group' ? styles.skDotSquare : styles.skDotRound)
                          .className
                      }
                    />
                    <Skeleton
                      className={stylex.props(styles.skTreeLine).className}
                      style={{ width }}
                    />
                    {kind === 'group' && (
                      <Skeleton className={stylex.props(styles.skTreeLedger).className} />
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div {...stylex.props(styles.skMain)}>
              <Skeleton className={stylex.props(styles.skCard).className} />
              {[0, 1].map((block) => (
                <div key={block} {...stylex.props(styles.skBlock)}>
                  <Skeleton className={stylex.props(styles.skBlockTitle).className} />
                  <Skeleton className={stylex.props(styles.skBlockMeta).className} />
                  <Skeleton className={stylex.props(styles.skBlockBody).className} />
                </div>
              ))}
            </div>
          </div>
        </div>
      }
      xstyle={styles.fill}
    >
      {rows.length === 0 ? (
        <p {...stylex.props(styles.emptyNote)}>{format(m.myEntriesEmpty)}</p>
      ) : (
        <div {...stylex.props(styles.pageWrap)}>
          <div {...stylex.props(styles.panes)}>
            <Structure
              rows={rows}
              batchName={batchName}
              standing={(standing.data ?? null) as Standing | null}
              openId={marked}
              onOpen={goTo}
            />

            <div ref={setPaper} {...stylex.props(styles.paperPane)}>
              {/* The paper's own toolbar. Beside the rail it is the pane's
                  own edge, outside the scroller and level with the rail's
                  heading; narrow it rides sticky at the top of the page's
                  scroll, with the strip naming the section being read pinned
                  to its underside. The display card stays in the paper; the
                  strip is its short understudy, gone whenever the card
                  itself is on screen. */}
              <div {...stylex.props(styles.headSticky)}>
                <div ref={setHead} {...stylex.props(styles.headSurface)}>
                  <div {...stylex.props(styles.narrowHead)}>
                    <div {...stylex.props(styles.narrowTitleRow)}>
                      <div {...stylex.props(styles.narrowTitleCol)}>
                        <h1 {...stylex.props(styles.narrowTitle)}>{format(m.myEntriesTab)}</h1>
                        <p {...stylex.props(styles.narrowMeta)}>
                          {format(m.myEntriesPaperMeta, {
                            groups: bandCount,
                            items: questionCount,
                          })}
                        </p>
                      </div>
                      <span {...stylex.props(styles.spacer)} />
                      <div {...stylex.props(styles.countSeat)}>
                        <span {...stylex.props(styles.countLabel)}>
                          {format(m.myEntriesCounted)}
                        </span>
                        <span {...stylex.props(styles.countValue)}>
                          {standing.data === undefined
                            ? '—'
                            : Number(standing.data.total).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div {...stylex.props(styles.narrowControls)}>
                      <Segmented
                        value={paperView}
                        onChange={(next) => setPaperView(next as 'all' | 'todo')}
                        label={format(m.paperViewAll)}
                        fill
                        xstyle={styles.switchGrow}
                        options={[
                          { value: 'all', label: format(m.paperViewAll) },
                          {
                            value: 'todo',
                            label: (
                              <span {...stylex.props(styles.switchOption)}>
                                {format(m.paperViewTodo)}
                                {todoCount > 0 && (
                                  <span {...stylex.props(styles.nums)}>{todoCount}</span>
                                )}
                              </span>
                            ),
                          },
                        ]}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className={stylex.props(styles.shrinkNone).className}
                        onClick={() => setStructure('1')}
                      >
                        <TableOfContentsIcon aria-hidden />
                        {format(m.paperStructureShort)}
                      </Button>
                    </div>
                  </div>
                  <div {...stylex.props(styles.wideHead)}>
                    <div {...stylex.props(styles.wideHeadInner)}>
                      <h1 {...stylex.props(styles.wideTitle)}>{format(m.myEntriesTab)}</h1>
                      <span aria-hidden {...stylex.props(styles.headRule)} />
                      <span {...stylex.props(styles.countSeat)}>
                        <span {...stylex.props(styles.countLabelXs)}>
                          {format(m.myEntriesCounted)}
                        </span>
                        <span {...stylex.props(styles.wideCountValue)}>
                          {standing.data === undefined
                            ? '—'
                            : Number(standing.data.total).toFixed(2)}
                        </span>
                      </span>
                      <span {...stylex.props(styles.spacer)} />
                      {/* the escape hatch, not the mechanism: state flows in
                          on its own, and this is for the person who wants to
                          ask the server directly anyway */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={stylex.props(styles.shrinkNone).className}
                        disabled={anyFetching}
                        onClick={refetchAll}
                      >
                        <RefreshCwIcon
                          aria-hidden
                          className={stylex.props(anyFetching && styles.spinning).className}
                        />
                        <span {...stylex.props(styles.srOnly)}>{format(m.myEntriesRefresh)}</span>
                      </Button>
                      <span {...stylex.props(styles.statChip)}>
                        <span {...stylex.props(styles.statPair)}>
                          {format(m.entryStatusInReview)}
                          <span {...stylex.props(styles.statNum)}>{pendingCount}</span>
                        </span>
                        <span {...stylex.props(styles.statPair)}>
                          {format(m.entryStatusDraft)}
                          <span {...stylex.props(styles.statNum)}>{draftCount}</span>
                        </span>
                        <span {...stylex.props(styles.statPair)}>
                          {format(m.entryStatusNeedsRevision)}
                          <span
                            {...stylex.props(styles.statNum, backCount > 0 && styles.statNumAlert)}
                          >
                            {backCount}
                          </span>
                        </span>
                      </span>
                      <Segmented
                        value={paperView}
                        onChange={(next) => setPaperView(next as 'all' | 'todo')}
                        label={format(m.paperViewAll)}
                        options={[
                          { value: 'all', label: format(m.paperViewAll) },
                          { value: 'todo', label: format(m.paperViewTodo) },
                        ]}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 lg:hidden"
                        onClick={() => setStructure('1')}
                      >
                        <TableOfContentsIcon aria-hidden />
                        {format(m.paperStructureShort)}
                      </Button>
                    </div>
                  </div>
                </div>
                {/* the 36px understudy of the section card, narrow only:
                    the rail keeps the desktop reader oriented instead */}
                <div {...stylex.props(styles.stripSeat)}>
                  <Appear show={currentBand !== null} collapse>
                    <div data-testid="band-strip" {...stylex.props(styles.strip)}>
                      <div {...stylex.props(styles.stripInner)}>
                        <span {...stylex.props(styles.stripNo)}>
                          {currentBand !== null ? bandNoOf(currentBand) : ''}
                        </span>
                        <span {...stylex.props(styles.stripName)}>{currentBand?.name}</span>
                        <span {...stylex.props(styles.spacer)} />
                        <span {...stylex.props(styles.stripLedger)}>
                          {currentBand === null || currentBand.right === ''
                            ? ''
                            : Number(currentBand.right).toFixed(2)}
                          {currentBand?.cap != null && currentBand.cap !== ''
                            ? ` / ${trimAmount(String(currentBand.cap))}`
                            : ''}
                        </span>
                      </div>
                    </div>
                  </Appear>
                </div>
              </div>
              <PaneScroller>
                {/* the same paper, narrowed: it fades over itself so the
                    switch reads as this paper changing rather than another
                    one arriving */}
                <Swap swapKey={paperView} className={stylex.props(styles.swapSeat).className}>
                  <Paper
                    rows={rows}
                    entriesByItem={entriesByItem}
                    filing={filingByItem}
                    standing={(standing.data ?? null) as Standing | null}
                    showTodoOnly={paperView === 'todo'}
                    busy={setStatus.isPending || declare.isPending}
                    onFile={(item, entry) => openAndFile(item.id, entry?.id ?? 'new')}
                    onDeclare={(item) => declare.mutate({ itemId: item.id })}
                    onDetail={(entry) => setDetail(entry.id)}
                  />
                </Swap>
              </PaneScroller>
            </div>
          </div>
        </div>
      )}

      {/* Narrow only: the structure, folded into a drawer the toolbar
          opens. The same rows, the same goTo - picking one scrolls the
          paper and the drawer's own layer clears in the same address write,
          so the back key walks drawer-then-page like any other layer. */}
      {!beside && (
        <Sheet
          open={structure !== ''}
          onOpenChange={(next) => {
            if (!next) setStructure('')
          }}
        >
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="max-h-[82dvh] gap-0 overflow-hidden rounded-t-[20px] p-0"
          >
            <SheetTitle className="sr-only">{format(m.paperStructure)}</SheetTitle>
            <span aria-hidden data-sheet-grab="" {...stylex.props(styles.dragHandle)} />
            <Structure
              variant="sheet"
              rows={rows}
              batchName={batchName}
              standing={(standing.data ?? null) as Standing | null}
              openId={marked}
              onOpen={goTo}
            />
          </SheetContent>
        </Sheet>
      )}

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {lingeringFiling !== null && mine.data !== undefined && (
        <EntryDialog
          key={lingeringFiling.entry?.id ?? `new:${lingeringFiling.item.id}`}
          open={writing !== null}
          batchId={batchId}
          materialRange={materialRange}
          participantId={mine.data.participantId}
          item={lingeringFiling.item}
          entry={lingeringFiling.entry}
          submitGate={filingByItem.get(lingeringFiling.item.id)?.submit}
          trail={lingeringFiling.trail}
          siblings={(entriesByItem.get(lingeringFiling.item.id) ?? []).filter(
            (one) => one.id !== lingeringFiling.entry?.id,
          )}
          onClose={() => setFiling('')}
          onSaved={() => {
            setFiling('')
            refresh()
          }}
          onStale={() => void items.refetch()}
        />
      )}
      {/* the drawer that holds the whole claim; its account is a tab inside */}
      {lingeringDetail !== null && (
        <EntrySheet
          open={detailed !== null}
          entry={detailed?.entry ?? lingeringDetail.entry}
          item={lingeringDetail.item}
          resubmit={filingByItem.get(lingeringDetail.item.id)?.submit}
          trail={lingeringDetail.trail}
          busy={setStatus.isPending || declare.isPending}
          onClose={() => setDetail('')}
          onEdit={() => openAndFile(lingeringDetail.item.id, lingeringDetail.entry.id)}
          onStatus={(status, expectedItemRevisionId) =>
            setStatus.mutate({
              entryId: lingeringDetail.entry.id,
              status,
              ...(expectedItemRevisionId === undefined ? {} : { expectedItemRevisionId }),
            })
          }
          onAppeal={() => setAppealing(lingeringDetail.entry)}
          onSupplement={() => setAnswering(lingeringDetail.entry)}
        />
      )}
      {lingeringAppeal?.currentReviewInstanceId != null && (
        <AppealDialog
          open={appealing !== null}
          instanceId={lingeringAppeal.currentReviewInstanceId}
          onClose={() => setAppealing(null)}
          onDone={() => {
            setAppealing(null)
            refresh()
          }}
        />
      )}
      {lingeringAnswer?.supplement != null && (
        <SupplementAnswerDialog
          open={answering !== null}
          entry={lingeringAnswer}
          supplement={lingeringAnswer.supplement}
          onClose={() => setAnswering(null)}
          onDone={() => {
            setAnswering(null)
            refresh()
          }}
        />
      )}
    </AsyncSection>
  )
}

/**
 * A pane that scrolls inside itself beside its peer, and flows as part of
 * the page when the two stack. ScrollArea's viewport always clips, so the
 * stacked case renders none at all. `relative`, because a scroller that is
 * not a positioning context cannot clip its absolute descendants.
 */
function PaneScroller({ children }: { children: ReactNode }) {
  const beside = useSideBySide()
  return beside ? (
    <ScrollArea className={stylex.props(styles.paneScroller).className}>{children}</ScrollArea>
  ) : (
    <>{children}</>
  )
}

/** the groups above a row, outermost first, with the ids that open them */
const crumbsOf = (
  rows: readonly StructureRow[],
  row: StructureRow,
): readonly { id: string; name: string }[] => {
  const out: { id: string; name: string }[] = []
  let at = row.parentId
  while (at !== null) {
    const group = rows.find((one) => one.id === at)
    if (group === undefined) break
    out.unshift({ id: group.id, name: group.name })
    at = group.parentId
  }
  return out
}

/**
 * The round, as one list of rows to choose from.
 *
 * Groups and questions sit at the same indent scale rather than as headings
 * over lists, so the depth of the paper reads the way it is written and a
 * question two levels down is reachable in one press.
 */
function Structure({
  rows,
  batchName,
  standing,
  openId,
  onOpen,
  variant = 'rail',
}: {
  rows: readonly StructureRow[]
  batchName: string
  standing: Standing | null
  openId: string | null
  onOpen: (id: string) => void
  /**
   * Where the structure is standing: `rail` is the column beside the paper,
   * `sheet` is the same list inside the drawer the narrow toolbar opens -
   * without the summary card, because the drawer's little height belongs to
   * the rows, and the card's numbers are already on the toolbar above.
   */
  variant?: 'rail' | 'sheet'
}) {
  const { format } = useI18n()
  const [showing, setShowing] = useState<'all' | 'todo'>('all')
  // the rail reads along: when the paper's scroll moves the mark, the rail
  // scrolls its own list just enough to keep the marked row in view
  const railRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  // where the mark stands: the active row's box within the list. Measured,
  // not rendered per row - a permanently mounted mark that slides has no
  // unmount between two positions for the eye to catch as a blink.
  const [markBox, setMarkBox] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const list = listRef.current
    if (list === null || openId === null) {
      setMarkBox(null)
      return
    }
    const row = list.querySelector(`[data-rail-row="${openId}"]`)
    if (!(row instanceof HTMLElement)) {
      setMarkBox(null)
      return
    }
    setMarkBox({ top: row.offsetTop, height: row.offsetHeight })
  }, [openId, showing, rows])
  useEffect(() => {
    if (openId === null) return
    const viewport = railRef.current?.querySelector('[data-slot="scroll-area-viewport"]')
    const row = railRef.current?.querySelector(`[data-rail-row="${openId}"]`)
    if (!(viewport instanceof HTMLElement) || !(row instanceof Element)) return
    // plain arithmetic instead of scrollIntoView: nearest-edge scrolling
    // that nothing can cancel, and it never tugs any other scroller
    const port = viewport.getBoundingClientRect()
    const at = row.getBoundingClientRect()
    if (at.top < port.top + 8) {
      viewport.scrollTop += at.top - port.top - 8
    } else if (at.bottom > port.bottom - 8) {
      viewport.scrollTop += at.bottom - port.bottom + 8
    }
  }, [openId])
  // The summary card at the top IS the paper's root: when the round has one
  // top group holding everything, that group's name and numbers go up there
  // and the list starts straight at its children - a root row over children
  // saying the same thing said it twice. Papers with several top groups
  // have no single root to lift, so the batch stands in.
  const root =
    rows.length > 0 &&
    rows[0]!.kind === 'group' &&
    rows.filter((row) => row.depth === 0).length === 1
      ? rows[0]!
      : null
  const body = root === null ? rows : rows.slice(1).map((row) => ({ ...row, depth: row.depth - 1 }))
  const questions = body.filter((row) => row.kind === 'item').length
  const todo = body.filter((row) => row.todo).length
  // narrowed to what is outstanding, the sections above it are scaffolding
  // for rows that are no longer there
  const listed = showing === 'all' ? body : body.filter((row) => row.todo)
  // the card's numbers: the root group's own ledger, or the paper-wide sum
  const capSum =
    root !== null && root.cap != null && root.cap !== ''
      ? Number(root.cap)
      : body
          .filter((row) => row.kind === 'group' && row.depth === 0)
          .reduce((sum, row) => sum + (row.cap == null || row.cap === '' ? 0 : Number(row.cap)), 0)
  const got =
    root !== null && root.right !== ''
      ? Number(root.right)
      : standing === null
        ? 0
        : Number(standing.total)
  const groupCount = body.filter((row) => row.kind === 'group' && row.depth === 0).length

  // Which rows still have a sibling below them at their own depth, and which
  // open a subtree: the connector lines are drawn per row from these two
  // facts, the way a file tree draws them.
  const joints = listed.map((row, index) => {
    const after = listed.slice(index + 1).find((one) => one.depth <= row.depth)
    const next = listed[index + 1]
    return {
      last: after === undefined || after.depth < row.depth,
      hasKids: next !== undefined && next.depth > row.depth,
    }
  })

  // the tree itself, one list shared by the rail and the drawer
  const tree =
    listed.length === 0 ? (
      <p {...stylex.props(styles.treeEmpty)}>{format(m.myEntriesFilterNone)}</p>
    ) : (
      <ul ref={listRef} {...stylex.props(styles.tree)}>
        {markBox !== null && (
          <Glide
            top={markBox.top}
            height={markBox.height}
            className={stylex.props(styles.glideMark).className}
          />
        )}
        <Sift>
          {listed.map((row, index) => {
            const depth = showing === 'all' ? row.depth : 0
            const joint = joints[index]!
            const gone = row.tag === 'voided'
            // the row's word asks for a raised voice only while the round
            // is waiting on the reader
            const urgent = row.tag === 'supplement' || row.tag === 'needs_revision'
            const capNum =
              row.cap === null || row.cap === undefined || row.cap === '' ? 0 : Number(row.cap)
            const gotNum = row.right === '' ? 0 : Number(row.right)
            return (
              <SiftRow key={row.id}>
                <button
                  type="button"
                  data-rail-row={row.id}
                  // the mark behind the row is paint; this is the part a
                  // screen reader can hear
                  aria-current={openId === row.id ? 'true' : undefined}
                  onClick={() => onOpen(row.id)}
                  {...stylex.props(
                    styles.row,
                    openId !== row.id && styles.rowHoverable,
                    row.kind === 'group' && row.depth === 0 && index > 0 && styles.rowTopGap,
                    gone && styles.rowGone,
                  )}
                  style={{ paddingLeft: `${depth * 14 + 10}px` }}
                >
                  {showing === 'all' && depth > 0 && (
                    <>
                      <span
                        aria-hidden
                        {...stylex.props(styles.elbow)}
                        style={{ left: `${(depth - 1) * 14 + 12}px` }}
                      />
                      {!joint.last && (
                        <span
                          aria-hidden
                          {...stylex.props(styles.siblingLine)}
                          style={{ left: `${(depth - 1) * 14 + 12}px` }}
                        />
                      )}
                    </>
                  )}
                  {showing === 'all' && row.kind === 'group' && joint.hasKids && (
                    <span
                      aria-hidden
                      {...stylex.props(styles.downLine)}
                      style={{ left: `${depth * 14 + 12}px` }}
                    />
                  )}
                  {row.kind === 'group' ? (
                    <span aria-hidden {...stylex.props(styles.groupSquare)} />
                  ) : row.unread ? (
                    <span
                      role="status"
                      data-testid="unread-dot"
                      aria-label={format(m.rowUnread)}
                      {...stylex.props(styles.unreadDot)}
                    />
                  ) : (
                    <span
                      aria-hidden
                      {...stylex.props(
                        styles.dot,
                        row.tag === null ? styles.dotHollow : DOT[row.tag],
                      )}
                    />
                  )}
                  <span
                    {...stylex.props(
                      styles.rowName,
                      (row.kind === 'group' || openId === row.id) && styles.rowNameStrong,
                      gone && styles.rowNameGone,
                    )}
                  >
                    {row.name}
                  </span>
                  {row.kind === 'item' && row.tag !== null && (
                    <span {...stylex.props(styles.tagWord, urgent && styles.tagWordUrgent)}>
                      {format(ROW_TAG[row.tag])}
                    </span>
                  )}
                  {row.kind === 'group' ? (
                    <span {...stylex.props(styles.ledgerCol)}>
                      <span {...stylex.props(styles.ledgerLine)}>
                        <span
                          {...stylex.props(styles.ledgerGot, gotNum === 0 && styles.ledgerGotZero)}
                        >
                          {row.right === '' ? '0' : trimAmount(row.right)}
                        </span>
                        <span {...stylex.props(styles.ledgerCap)}>
                          {capNum > 0
                            ? `/ ${trimAmount(String(capNum))}`
                            : format(m.myEntriesPaperUnit)}
                        </span>
                      </span>
                      {capNum > 0 && (
                        <span {...stylex.props(styles.miniMeter)}>
                          <span
                            {...stylex.props(styles.meterFill)}
                            style={{
                              width: `${Math.round(Math.min(1, gotNum / capNum) * 100)}%`,
                            }}
                          />
                        </span>
                      )}
                    </span>
                  ) : (
                    // a question that has granted nothing yet says
                    // nothing: a 0 beside every untouched row reads as a
                    // page full of failures
                    gotNum > 0 && (
                      <span {...stylex.props(styles.itemWorth)}>
                        {trimAmount(row.right)} {format(m.myEntriesPaperUnit)}
                      </span>
                    )
                  )}
                </button>
              </SiftRow>
            )
          })}
        </Sift>
      </ul>
    )

  const filterTabs = (
    <Segmented
      value={showing}
      onChange={(next) => setShowing(next as 'all' | 'todo')}
      label={format(m.myEntriesFilterAll)}
      options={[
        { value: 'all', label: format(m.myEntriesFilterAll) },
        {
          value: 'todo',
          label: (
            <span {...stylex.props(styles.switchOption)}>
              {format(m.myEntriesFilterTodo)}
              {todo > 0 && <span {...stylex.props(styles.nums)}>{todo}</span>}
            </span>
          ),
        },
      ]}
    />
  )

  if (variant === 'sheet') {
    return (
      <div ref={railRef} {...stylex.props(styles.sheetRoot)}>
        <div data-sheet-grab="" {...stylex.props(styles.sheetHead)}>
          <p {...stylex.props(styles.sheetTitle)}>{format(m.paperStructure)}</p>
          <span {...stylex.props(styles.sheetMeta)}>
            {format(m.myEntriesPaperMeta, { groups: groupCount, items: questions })}
          </span>
          <span {...stylex.props(styles.spacer)} />
          {filterTabs}
        </div>
        <div {...stylex.props(styles.sheetBody)}>{tree}</div>
      </div>
    )
  }

  return (
    // its own column, on the widths that afford one: the page's index,
    // scrolling inside itself beside the paper
    <div ref={railRef} {...stylex.props(styles.railRoot)}>
      <div {...stylex.props(styles.railHead)}>
        <p {...stylex.props(styles.railTitle)}>{format(m.paperStructure)}</p>
      </div>
      <PaneScroller>
        <div {...stylex.props(styles.railBody)}>
          <div {...stylex.props(styles.railTop)}>
            {filterTabs}
            <span {...stylex.props(styles.spacer)} />
            <p {...stylex.props(styles.railCount)}>
              {format(m.myEntriesQuestions, { count: questions })}
            </p>
          </div>

          <div {...stylex.props(styles.summaryCard)}>
            <div {...stylex.props(styles.sumRow)}>
              <span {...stylex.props(styles.sumName)}>{root?.name ?? batchName}</span>
              <span {...stylex.props(styles.spacer)} />
              <span {...stylex.props(styles.sumValue, got === 0 && styles.sumValueZero)}>
                {got.toFixed(2)}
              </span>
              <span {...stylex.props(styles.sumUnit)}>{format(m.myEntriesPaperUnit)}</span>
            </div>
            {capSum > 0 && (
              <span {...stylex.props(styles.meter)}>
                <span
                  {...stylex.props(styles.meterFill)}
                  style={{ width: `${Math.min(100, Math.round((got / capSum) * 100))}%` }}
                />
              </span>
            )}
            <div {...stylex.props(styles.sumFoot)}>
              {capSum > 0 && (
                <span {...stylex.props(styles.noWrap)}>
                  {format(m.myEntriesPaperCap, { value: capSum.toFixed(0) })}
                </span>
              )}
              <span {...stylex.props(styles.spacer)} />
              <span {...stylex.props(styles.noWrap)}>
                {format(m.myEntriesPaperMeta, { groups: groupCount, items: questions })}
              </span>
            </div>
          </div>

          {tree}
        </div>
      </PaneScroller>
    </div>
  )
}
