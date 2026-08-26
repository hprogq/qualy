import { useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Appear } from '@qualy/ui/reveal'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleSlashIcon,
  ClockIcon,
  FileTextIcon,
  PlusIcon,
} from 'lucide-react'
import { projectEntrySummary } from '../../entry/summary.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { EntryStanding } from './EntryStanding.tsx'
import { entryRefusalReason } from './refusals.ts'
import { fieldsOf, trimAmount, type EntryDto, type FilingGateDto, type ItemDto } from './model.ts'
import {
  chainNamesOf,
  eachWorth,
  entryScore,
  itemScore,
  mayFile,
  roomLeft,
  type Standing,
  type StructureRow,
} from './standing.ts'

// The whole paper, top to bottom: a band per group, a row per question, and
// the question's own claims as table rows whose count decides the row's
// height. Nothing is chosen to be seen - which questions stand empty and
// which are full is one scan - and any claim row opens the drawer where the
// whole claim lives. The rail beside it follows the scroll; this file only
// reports which row is under the reader through `data-paper-row`.
//
// One paper, three widths. Under 768 the question is a single column and a
// claim is two lines of one row; to 1024 the terms stand beside a
// three-column table with the version folded into the content cell; wider,
// the four-column table. The same rows, the same drawer behind them - only
// the columns give way, never the content.

const md = '@media (min-width: 768px)'
const lg = '@media (min-width: 1024px)'
const xl = '@media (min-width: 1280px)'
const belowMd = '@media (max-width: 767.98px)'

const styles = stylex.create({
  // Rules run edge to edge while the writing stays inside one measure: the
  // paper reads as sheets divided by lines, not as a stack of floating cards.
  measure: {
    marginInline: 'auto',
    width: '100%',
    maxWidth: '72rem',
    paddingInline: {
      default: 16,
      [lg]: 24,
    },
  },
  // room at the foot for the shell's floating capsule where it floats
  paper: {
    display: 'flex',
    flexDirection: 'column',
    paddingBottom: {
      default: 112,
      [lg]: 64,
    },
  },
  band: {
    scrollMarginTop: {
      default: 120,
      [lg]: 64,
    },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundImage: `linear-gradient(to right, color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent), ${tokens.background} 65%)`,
  },
  // phone: the name gets a line, the progress gets the next
  bandNarrow: {
    display: {
      default: 'flex',
      [md]: 'none',
    },
    flexDirection: 'column',
    gap: 8,
    paddingBlock: 12,
  },
  bandNarrowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  bandNoNarrow: {
    flexShrink: 0,
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 600,
    letterSpacing: '-0.025em',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  bandNameNarrow: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 16,
    lineHeight: 1.25,
    fontWeight: 600,
  },
  bandNarrowMeter: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  // tablet: one line, worth its 42px and no more
  bandMid: {
    display: {
      default: 'none',
      [md]: 'flex',
      [lg]: 'none',
    },
    height: 42,
    alignItems: 'center',
    gap: 14,
  },
  bandNoMid: {
    flexShrink: 0,
    fontSize: 15,
    lineHeight: 1,
    fontWeight: 600,
    letterSpacing: '-0.025em',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  bandNameMid: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    lineHeight: 1.25,
    fontWeight: 600,
  },
  // laptop and wider: the display card the section deserves
  bandWide: {
    display: {
      default: 'none',
      [lg]: 'flex',
    },
    alignItems: 'center',
    gap: 24,
    paddingBlock: 16,
  },
  bandNoWide: {
    flexShrink: 0,
    fontSize: 30,
    lineHeight: 1,
    fontWeight: 600,
    letterSpacing: '-0.025em',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  bandWideCol: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
  },
  bandNameWide: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 18,
    lineHeight: 1.25,
    fontWeight: 600,
  },
  bandWideMeter: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  share: {
    flexShrink: 0,
    fontSize: {
      default: 11,
      [md]: 12,
    },
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  ledger: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'baseline',
    gap: 6,
    whiteSpace: 'nowrap',
  },
  ledgerGot: {
    lineHeight: 1,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  ledgerGotZero: {
    color: tokens.mutedForeground,
  },
  ledgerLg: {
    fontSize: 18,
  },
  ledgerBase: {
    fontSize: 16,
  },
  ledgerXl: {
    fontSize: 20,
  },
  ledgerCap: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  meter: {
    display: 'block',
    overflow: 'hidden',
    borderRadius: '9999px',
    backgroundColor: tokens.border,
  },
  meterNarrow: {
    height: 4,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  meterWide: {
    height: 3,
    width: 96,
    flexShrink: 0,
  },
  meterFill: {
    display: 'block',
    height: '100%',
    borderRadius: '9999px',
    backgroundColor: tokens.foreground,
  },
  subBand: {
    scrollMarginTop: {
      default: 136,
      [lg]: 96,
    },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundImage: `linear-gradient(to right, color-mix(in oklab, ${tokens.surfaceMuted} 45%, transparent), ${tokens.background} 55%)`,
  },
  subBandRow: {
    display: 'flex',
    height: {
      default: 36,
      [lg]: 44,
    },
    alignItems: 'center',
    gap: {
      default: 12,
      [lg]: 16,
    },
  },
  subBandNo: {
    flexShrink: 0,
    fontSize: {
      default: 12,
      [lg]: 14,
    },
    fontWeight: 600,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  subBandName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: {
      default: 13,
      [lg]: 14,
    },
    fontWeight: 600,
  },
  subBandGot: {
    fontSize: {
      default: 14,
      [lg]: 16,
    },
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  question: {
    scrollMarginTop: {
      default: 136,
      [lg]: 96,
    },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  questionVoided: {
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 15%, transparent)`,
  },
  questionBody: {
    display: 'grid',
    gap: {
      default: 16,
      [md]: 24,
      [lg]: 32,
      [xl]: 40,
    },
    paddingBlock: {
      default: 20,
      [md]: 24,
      [lg]: 28,
    },
    gridTemplateColumns: {
      default: null,
      [md]: '17rem minmax(0, 1fr)',
      [lg]: '19rem minmax(0, 1fr)',
      [xl]: '21rem minmax(0, 1fr)',
    },
  },
  questionBodyVoided: {
    paddingTop: 8,
    opacity: 0.75,
  },
  // the question itself: what it asks, what it pays, the way in
  terms: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
  },
  termsHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
  },
  questionNo: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  questionTitle: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    fontSize: {
      default: 15,
      [md]: 16,
    },
    lineHeight: 1.375,
    fontWeight: 600,
  },
  questionCounted: {
    flexShrink: 0,
    fontSize: {
      default: 15,
      [md]: 16,
    },
    fontWeight: 600,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  description: {
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
  },
  // what the question pays and asks for - one line on a phone, a term to a
  // line where there is height to spend - closing with the clause it scores
  // under; the association feature takes that seat next
  termsCard: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 30%, transparent)`,
    fontSize: 12,
  },
  termsLine: {
    display: {
      default: 'block',
      [md]: 'none',
    },
    paddingInline: 12,
    paddingBlock: 8,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  termsList: {
    display: {
      default: 'none',
      [md]: 'flex',
    },
    flexDirection: 'column',
    gap: 6,
    paddingInline: 12,
    paddingBlock: 10,
    color: tokens.mutedForeground,
  },
  termsRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingInline: 12,
    paddingBlock: 8,
    color: tokens.mutedForeground,
  },
  termsDivided: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  basisRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    paddingInline: 12,
    paddingBlock: 8,
    color: tokens.mutedForeground,
  },
  routeLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  keepShort: {
    flexShrink: 0,
  },
  routeSteps: {
    minWidth: 0,
    lineHeight: 1.625,
  },
  basisWords: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  termsFoot: {
    display: {
      default: 'none',
      [md]: 'block',
    },
    minHeight: 8,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  // the way in and the quota live in the claims list on a phone, where the
  // thumb already is
  wayIn: {
    display: {
      default: 'none',
      [md]: 'flex',
    },
    alignItems: 'center',
    gap: 12,
  },
  quota: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'baseline',
    gap: 6,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  quotaLabel: {
    color: tokens.mutedForeground,
  },
  nums: {
    fontVariantNumeric: 'tabular-nums',
  },
  shrinkNone: {
    flexShrink: 0,
  },
  noPointer: {
    pointerEvents: 'none',
  },
  // The claims, a row each, in their own sheet; the row is the way into the
  // drawer. The sheet keeps its head whether or not there is anything under
  // it - a question with nothing filed yet is the same table, empty, not a
  // different thing on the page.
  claims: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  claimsSheet: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    overflow: {
      default: null,
      [md]: 'hidden',
    },
    borderRadius: {
      default: null,
      [md]: `calc(${tokens.radiusLg} + 4px)`,
    },
    borderWidth: {
      default: 0,
      [md]: 1,
    },
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  claimsSheetFilled: {
    backgroundColor: {
      default: null,
      [md]: tokens.surface,
    },
  },
  claimsSheetTopRule: {
    borderTopWidth: {
      default: 1,
      [md]: 1,
    },
  },
  // a question granted to everybody has no claims to table, ever, so it
  // says so inside a tray instead of under column headings that will never
  // have anything under them
  claimsSheetGranted: {
    overflow: 'hidden',
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 20%, transparent)`,
  },
  claimHead: {
    display: {
      default: 'none',
      [md]: 'grid',
    },
    gridTemplateColumns: {
      default: null,
      [md]: 'minmax(0, 1fr) 6rem 5.5rem',
      [lg]: 'minmax(0, 1fr) 8.5rem 6rem 5.5rem',
    },
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
    height: 32,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  colToLg: {
    display: {
      default: 'inline',
      [lg]: 'none',
    },
  },
  colFromLg: {
    display: {
      default: 'none',
      [lg]: 'inline',
    },
  },
  colRight: {
    textAlign: 'right',
  },
  foldButton: {
    display: 'flex',
    height: 36,
    width: '100%',
    cursor: 'pointer',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
      [md]: 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    fontSize: 12,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    transitionProperty: 'color',
  },
  foldIcon: {
    width: 14,
    height: 14,
  },
  foldIconOpen: {
    transform: 'rotate(180deg)',
  },
  // the next claim's own seat: it takes whatever room the filed ones
  // leave, so a question with one claim still stands as tall as the terms
  // beside it
  addSeat: {
    display: 'flex',
    width: '100%',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  addRow: {
    display: 'flex',
    minHeight: 44,
    width: '100%',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontSize: {
      default: 13,
      [md]: 12,
    },
    fontWeight: {
      default: 500,
      [md]: 400,
    },
    transitionProperty: 'color, background-color',
    borderBottomWidth: {
      default: 1,
      [md]: 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: {
      default: null,
      [md]: `color-mix(in oklab, ${tokens.surfaceMuted} 20%, transparent)`,
    },
  },
  addRowOpen: {
    cursor: 'pointer',
    color: {
      default: tokens.foreground,
      [md]: tokens.mutedForeground,
    },
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    },
  },
  addRowOpenHoverInk: {
    color: {
      default: tokens.foreground,
      ':hover': tokens.foreground,
    },
  },
  addRowShut: {
    pointerEvents: 'none',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  addIcon: {
    width: 14,
    height: 14,
  },
  // the quota, spoken where the next claim would have gone
  fullNote: {
    display: {
      default: 'flex',
      [md]: 'none',
    },
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontSize: 12,
    color: tokens.mutedForeground,
    borderBottomWidth: {
      default: 1,
      [md]: 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  // why the table stands empty: never filed, or never this person's to
  // file. Tinted, not white: an empty table body that matches the page
  // reads as a table that failed to draw its rows.
  emptyTray: {
    display: 'flex',
    minHeight: 112,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 16,
  },
  emptyTrayFrame: {
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 25%, transparent)`,
    borderRadius: {
      default: `calc(${tokens.radiusLg} + 4px)`,
      [md]: 0,
    },
    borderWidth: {
      default: 1,
      [md]: 0,
    },
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  emptyBadge: {
    display: 'flex',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    backgroundColor: tokens.surfaceMuted,
    color: tokens.mutedForeground,
  },
  emptyIcon: {
    width: 16,
    height: 16,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  emptyHint: {
    fontSize: 12,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  // A withdrawn question stays on the paper - what was filed under it is
  // still the reader's, and still theirs to argue about - but it is folded
  // away and greyed, and it says on its face why it was withdrawn.
  voidedHead: {
    display: 'flex',
    cursor: 'pointer',
    alignItems: 'center',
    gap: 12,
    paddingBlock: 12,
    textAlign: 'left',
  },
  voidedNo: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  voidedTitle: {
    maxWidth: 256,
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
    textDecorationColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  voidedBadge: {
    flexShrink: 0,
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    paddingInline: 6,
    paddingBlock: 2,
    fontSize: 11,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  voidedWhy: {
    display: {
      default: 'none',
      [md]: 'inline',
    },
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  voidedChevron: {
    width: 16,
    height: 16,
    flexShrink: 0,
    color: tokens.mutedForeground,
    transitionProperty: 'transform',
  },
  // ---- one claim as one table row ----
  claimRow: {
    display: 'grid',
    width: '100%',
    cursor: 'pointer',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) auto auto',
      [md]: 'minmax(0, 1fr) 6rem 5.5rem',
      [lg]: 'minmax(0, 1fr) 8.5rem 6rem 5.5rem',
    },
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingBlock: {
      default: 10,
      [md]: 14,
    },
    paddingInline: {
      default: 0,
      [md]: 16,
    },
    textAlign: 'left',
    transitionProperty: 'color, background-color',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  claimMain: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
  },
  claimIdentity: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
  },
  claimLead: {
    maxWidth: 176,
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  // the rest of the identity stays on a phone too: without it a claim
  // named by its second and third fields reads as nothing
  claimSub: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  // the folded cells, under the content where the width folds them
  claimFoldNarrow: {
    display: {
      default: 'flex',
      [md]: 'none',
    },
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
  },
  claimWhenNarrow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
    fontSize: 11,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  claimWhenMid: {
    display: {
      default: 'none',
      [md]: 'flex',
      [lg]: 'none',
    },
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
    fontSize: 11,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  claimWhenWide: {
    display: {
      default: 'none',
      [lg]: 'flex',
    },
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  claimWhenClock: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  claimStandingCell: {
    display: {
      default: 'none',
      [md]: 'block',
    },
    minWidth: 0,
  },
  claimScore: {
    display: 'flex',
    flexDirection: {
      default: 'column',
      [md]: 'row',
    },
    alignItems: {
      default: 'flex-end',
      [md]: 'baseline',
    },
    justifyContent: {
      default: null,
      [md]: 'flex-end',
    },
    gap: {
      default: 2,
      [md]: 6,
    },
    whiteSpace: 'nowrap',
  },
  claimScoreWord: {
    fontSize: {
      default: 10.5,
      [md]: 12,
    },
    color: tokens.mutedForeground,
  },
  claimScoreValue: {
    fontSize: 14,
    fontWeight: 500,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  claimScoreValueOk: {
    fontWeight: 600,
    color: tokens.foreground,
  },
  claimChevron: {
    display: {
      default: 'block',
      [md]: 'none',
    },
    width: 14,
    height: 14,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
})

export function Paper({
  rows,
  entriesByItem,
  filing,
  standing,
  showTodoOnly,
  busy,
  onFile,
  onDeclare,
  onDetail,
}: {
  rows: readonly StructureRow[]
  entriesByItem: ReadonlyMap<string, readonly EntryDto[]>
  /** the phase gate's word on filing into each question, from the entries read */
  filing: ReadonlyMap<string, FilingGateDto>
  standing: Standing | null
  /** the toolbar's own filter: only questions still waiting on the reader */
  showTodoOnly: boolean
  busy: boolean
  onFile: (item: ItemDto, entry: EntryDto | null) => void
  onDeclare: (item: ItemDto) => void
  onDetail: (entry: EntryDto) => void
}) {
  // the root group is the summary card's business; the paper starts at its
  // children, numbered 01.. as bands
  const root =
    rows.length > 0 &&
    rows[0]!.kind === 'group' &&
    rows.filter((row) => row.depth === 0).length === 1
      ? rows[0]!
      : null
  const body = root === null ? rows : rows.slice(1).map((row) => ({ ...row, depth: row.depth - 1 }))
  const listed = showTodoOnly ? body.filter((row) => row.kind === 'group' || row.todo) : body
  // a band with nothing left under it says nothing in the todo view
  const kept = listed.filter((row, index) => {
    if (row.kind !== 'group') return true
    const next = listed.slice(index + 1).find((one) => one.depth <= row.depth)
    const nextIndex = next === undefined ? listed.length : listed.indexOf(next)
    return listed.slice(index + 1, nextIndex).some((one) => one.kind === 'item')
  })
  // the caps of the top bands, for each band's share of the whole
  const capSum = body
    .filter((row) => row.kind === 'group' && row.depth === 0)
    .reduce((sum, row) => sum + (row.cap == null || row.cap === '' ? 0 : Number(row.cap)), 0)

  // Numbered over the whole paper, never over what is on screen: sections
  // carry a dotted number (01, 01.2) and questions carry a running one, so
  // the two can never be mistaken for each other, and question 17 is
  // question 17 whether or not the questions before it are being shown.
  const numbers = new Map<string, string>()
  let bandNo = 0
  let subNo = 0
  let questionNo = 0
  for (const row of body) {
    if (row.kind === 'group' && row.depth === 0) {
      bandNo += 1
      subNo = 0
      numbers.set(row.id, String(bandNo).padStart(2, '0'))
    } else if (row.kind === 'group') {
      subNo += 1
      numbers.set(row.id, `${String(bandNo).padStart(2, '0')}.${subNo}`)
    } else {
      questionNo += 1
      numbers.set(row.id, String(questionNo))
    }
  }

  return (
    <div {...stylex.props(styles.paper)}>
      {kept.map((row) => {
        if (row.kind === 'group' && row.depth === 0) {
          return (
            <Band
              key={row.id}
              row={row}
              no={numbers.get(row.id) ?? ''}
              share={capSum > 0 && row.cap != null ? Number(row.cap) / capSum : null}
            />
          )
        }
        if (row.kind === 'group') {
          return <SubBand key={row.id} row={row} no={numbers.get(row.id) ?? ''} />
        }
        return (
          <Question
            key={row.id}
            row={row}
            no={numbers.get(row.id) ?? ''}
            entries={entriesByItem.get(row.id) ?? []}
            gate={filing.get(row.id)}
            standing={standing}
            busy={busy}
            onFile={onFile}
            onDeclare={onDeclare}
            onDetail={onDetail}
          />
        )
      })}
    </div>
  )
}

/**
 * Amounts on the paper speak with two decimals, the way the ledger does.
 * Nothing counted yet is still 0.00 and not a dash - a dash in Chinese copy
 * reads as the numeral one; what keeps a zero from shouting is its weight,
 * not a substitute for it.
 */
const two = (value: string | number): string => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : String(value)
}

/**
 * A top group's band: number, name, progress, and its ledger line.
 *
 * Three arrangements of the same facts: a phone gives the name a line and
 * the progress the next one, a tablet holds everything on one 42px line,
 * and a laptop affords the display card. Which one shows is the width's
 * business alone.
 */
function Band({
  row,
  no,
  share,
}: {
  row: StructureRow
  no: string
  /** this band's part of the whole paper, when every top cap is known */
  share: number | null
}) {
  const { format } = useI18n()
  const cap = row.cap == null || row.cap === '' ? null : Number(row.cap)
  const got = row.right === '' ? 0 : Number(row.right)
  const pct = cap === null || cap === 0 ? 0 : Math.min(100, Math.round((got / cap) * 100))
  const ledger = (gotSize: stylex.StyleXStyles) => (
    <span {...stylex.props(styles.ledger)}>
      <span {...stylex.props(styles.ledgerGot, gotSize, got === 0 && styles.ledgerGotZero)}>
        {two(got)}
      </span>
      {cap !== null && (
        <span {...stylex.props(styles.ledgerCap)}>
          {format(m.paperCap, { value: trimAmount(String(cap)) })}
        </span>
      )}
    </span>
  )
  const bar = (size: stylex.StyleXStyles) =>
    cap !== null && (
      <span {...stylex.props(styles.meter, size)}>
        <span {...stylex.props(styles.meterFill)} style={{ width: `${pct}%` }} />
      </span>
    )
  return (
    <div data-paper-row={row.id} data-paper-band={row.id} {...stylex.props(styles.band)}>
      <div {...stylex.props(styles.measure, styles.bandNarrow)}>
        <div {...stylex.props(styles.bandNarrowHead)}>
          <span aria-hidden {...stylex.props(styles.bandNoNarrow)}>
            {no}
          </span>
          <h2 {...stylex.props(styles.bandNameNarrow)}>{row.name}</h2>
          {ledger(styles.ledgerLg)}
        </div>
        <div {...stylex.props(styles.bandNarrowMeter)}>
          {bar(styles.meterNarrow)}
          {share !== null && (
            <span {...stylex.props(styles.share)}>
              {format(m.paperBandShare, { pct: Math.round(share * 100) })}
            </span>
          )}
        </div>
      </div>
      <div {...stylex.props(styles.measure, styles.bandMid)}>
        <span aria-hidden {...stylex.props(styles.bandNoMid)}>
          {no}
        </span>
        <h2 {...stylex.props(styles.bandNameMid)}>{row.name}</h2>
        {share !== null && (
          <span {...stylex.props(styles.share)}>
            {format(m.paperBandShare, { pct: Math.round(share * 100) })}
          </span>
        )}
        <span {...stylex.props(styles.spacer)} />
        {ledger(styles.ledgerBase)}
      </div>
      <div {...stylex.props(styles.measure, styles.bandWide)}>
        <span aria-hidden {...stylex.props(styles.bandNoWide)}>
          {no}
        </span>
        <div {...stylex.props(styles.bandWideCol)}>
          <h2 {...stylex.props(styles.bandNameWide)}>{row.name}</h2>
          <div {...stylex.props(styles.bandWideMeter)}>
            {bar(styles.meterWide)}
            {share !== null && (
              <span {...stylex.props(styles.share)}>
                {format(m.paperBandShare, { pct: Math.round(share * 100) })}
              </span>
            )}
          </div>
        </div>
        <span {...stylex.props(styles.spacer)} />
        {ledger(styles.ledgerXl)}
      </div>
    </div>
  )
}

/** a nested group's smaller band */
function SubBand({ row, no }: { row: StructureRow; no: string }) {
  const { format } = useI18n()
  const cap = row.cap == null || row.cap === '' ? null : Number(row.cap)
  return (
    <div data-paper-row={row.id} {...stylex.props(styles.subBand)}>
      <div {...stylex.props(styles.measure, styles.subBandRow)}>
        <span aria-hidden {...stylex.props(styles.subBandNo)}>
          {no}
        </span>
        <h3 {...stylex.props(styles.subBandName)}>{row.name}</h3>
        <span {...stylex.props(styles.spacer)} />
        <span {...stylex.props(styles.ledger)}>
          <span
            {...stylex.props(
              styles.subBandGot,
              (row.right === '' || Number(row.right) === 0) && styles.ledgerGotZero,
            )}
          >
            {two(row.right === '' ? 0 : row.right)}
          </span>
          {cap !== null && (
            <span {...stylex.props(styles.ledgerCap)}>
              {format(m.paperCap, { value: trimAmount(String(cap)) })}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * A control the phase has shut, wearing its reason on hover.
 *
 * A disabled button fires no pointer events, so the focusable wrapper is
 * what anchors the tooltip - the same trick as the drawer's action bar.
 * When the gate is open the children pass through untouched.
 */
function Shut({
  when,
  why,
  xstyle,
  children,
}: {
  when: boolean
  why: string | null
  xstyle?: stylex.StyleXStyles
  children: ReactNode
}) {
  const { format } = useI18n()
  if (!when) return <>{children}</>
  const reason = why === null ? null : entryRefusalReason(why)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} {...stylex.props(xstyle)}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{format(reason ?? m.entryBlockedNow)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * One question: its terms on the left at a fixed measure, its claims on the
 * right in a table of their own deciding how tall the row is. Empty
 * questions carry their own tray saying why - not yet filed, or never this
 * person's to file.
 */
function Question({
  row,
  no,
  entries,
  gate,
  standing,
  busy,
  onFile,
  onDeclare,
  onDetail,
}: {
  row: StructureRow
  no: string
  entries: readonly EntryDto[]
  gate: FilingGateDto | undefined
  standing: Standing | null
  busy: boolean
  onFile: (item: ItemDto, entry: EntryDto | null) => void
  onDeclare: (item: ItemDto) => void
  onDetail: (entry: EntryDto) => void
}) {
  const { format } = useI18n()
  const [unfolded, setUnfolded] = useState(false)
  // a withdrawn question arrives folded: it is history, not work
  const [opened, setOpened] = useState(false)
  const item = row.item
  if (item === undefined) return null
  const description = String(
    (item.currentRevision?.displayConfig as { description?: unknown } | undefined)?.description ??
      '',
  ).trim()
  const each = eachWorth(item)
  const chain = chainNamesOf(item)
  const live = entries.filter((entry) => entry.status !== 'voided')
  const counted = itemScore(standing, item.id)
  const recorded = item.currentRevision?.entrySource === 'administrative'
  const voided = item.status === 'voided'
  const granted = item.itemType === 'constant'
  const declared = item.itemType === 'declaration'
  const room = roomLeft(item, entries)
  const full = !granted && !recorded && room !== null && room <= 0
  const declaredAlready = declared && live.some((entry) => entry.status === 'draft')
  // Structure first, then the phase: `mayAdd` says filing belongs on this
  // question at all, the gate says whether this minute allows it. A shut
  // gate renders the same control disabled with the reason on hover - a
  // button that only turns into a refusal toast after the dialog is a trap.
  const mayAdd =
    !full && mayFile(item, entries) && !declaredAlready && gate?.create.state !== 'hidden'
  const shut = gate !== undefined && gate.create.state === 'blocked'
  const add = () => (declared ? onDeclare(item) : onFile(item, null))

  // A question granted to everybody is administrative in the data, because
  // nobody fills it in - but nobody records it either, so it must not say so.
  // Its terms are the amount and the fact that it lands by itself, and that
  // is all there is to say about it.
  const terms = [
    each !== undefined
      ? format(granted ? m.paperGrantedEach : m.myEntriesHeadEach, { value: trimAmount(each) })
      : null,
    granted
      ? format(m.myEntriesGranted)
      : item.maxEntries !== null
        ? format(m.myEntriesHeadMost, { count: item.maxEntries })
        : null,
    granted ? null : recorded ? format(m.myEntriesRecorded) : null,
  ].filter((part): part is string => part !== null)
  // The routes by their step names and nothing else: who a step lands on -
  // levels, roles, people - is the round's business, not this reader's.
  const stepName = (label: string | null, index: number) =>
    label ?? format(m.entryFlowStep, { n: index + 1 })
  const routes =
    granted || recorded
      ? []
      : [
          chain.normal.length > 0
            ? { name: format(m.reviewRouteNormal), steps: chain.normal.map(stepName) }
            : null,
          chain.escalation.length > 0
            ? { name: format(m.reviewRouteEscalation), steps: chain.escalation.map(stepName) }
            : null,
        ].filter((route): route is { name: string; steps: string[] } => route !== null)

  const shown = unfolded ? live : live.slice(0, 6)

  const body = (
    <div
      {...stylex.props(styles.measure, styles.questionBody, voided && styles.questionBodyVoided)}
    >
      <div {...stylex.props(styles.terms)}>
        <div {...stylex.props(styles.termsHead)}>
          <span aria-hidden {...stylex.props(styles.questionNo)}>
            {no}.
          </span>
          <h3 {...stylex.props(styles.questionTitle)}>{item.title}</h3>
          {counted !== null && Number(counted) > 0 && (
            <span {...stylex.props(styles.questionCounted)}>{two(counted)}</span>
          )}
        </div>
        {description !== '' && <p {...stylex.props(styles.description)}>{description}</p>}
        <div {...stylex.props(styles.termsCard)}>
          {terms.length > 0 && (
            <>
              <p {...stylex.props(styles.termsLine)}>{terms.join('，')}</p>
              <ul {...stylex.props(styles.termsList)}>
                {terms.map((term) => (
                  <li key={term}>{term}</li>
                ))}
              </ul>
            </>
          )}
          {routes.length > 0 && (
            <div
              data-testid="question-chain"
              {...stylex.props(styles.termsRow, terms.length > 0 && styles.termsDivided)}
            >
              {routes.map((route) => (
                <p key={route.name} {...stylex.props(styles.routeLine)}>
                  <span {...stylex.props(styles.keepShort)}>{route.name}</span>
                  <span {...stylex.props(styles.routeSteps)}>{route.steps.join(' → ')}</span>
                </p>
              ))}
            </div>
          )}
          <p
            {...stylex.props(
              styles.basisRow,
              (terms.length > 0 || routes.length > 0) && styles.termsDivided,
            )}
          >
            <span {...stylex.props(styles.keepShort)}>{format(m.myEntriesBasis)}</span>
            <span {...stylex.props(styles.basisWords)}>{format(m.myEntriesBasisSoon)}</span>
          </p>
        </div>
        <span {...stylex.props(styles.termsFoot)} />
        <div {...stylex.props(styles.wayIn)}>
          {!granted && !recorded && item.maxEntries !== null && (
            <span {...stylex.props(styles.quota)}>
              <span {...stylex.props(styles.quotaLabel)}>{format(m.myEntriesQuota)}</span>
              <span {...stylex.props(styles.nums)}>
                {live.length} / {item.maxEntries}
              </span>
            </span>
          )}
          <span {...stylex.props(styles.spacer)} />
          {/* Where there is nothing to press, a badge says why in a word
              rather than a control that exists only to be refused. Three
              reasons, one shape: the quota is used up, somebody else fills
              this one in, or it lands by itself. */}
          {full ? (
            <Badge variant="secondary" className={stylex.props(styles.shrinkNone).className}>
              <CircleSlashIcon aria-hidden />
              {format(m.myEntriesAddFull)}
            </Badge>
          ) : granted ? (
            <Badge variant="secondary" className={stylex.props(styles.shrinkNone).className}>
              <CheckIcon aria-hidden />
              {format(m.paperEmptyGranted)}
            </Badge>
          ) : recorded ? (
            <Badge variant="secondary" className={stylex.props(styles.shrinkNone).className}>
              <ClockIcon aria-hidden />
              {format(m.myEntriesRecorded)}
            </Badge>
          ) : (
            mayAdd && (
              <Shut when={shut} why={gate?.create.reason ?? null} xstyle={styles.shrinkNone}>
                <Button
                  data-testid="file-claim"
                  data-gate={gate?.create.state ?? 'available'}
                  size="sm"
                  className={stylex.props(styles.shrinkNone, shut && styles.noPointer).className}
                  disabled={busy || shut}
                  onClick={add}
                >
                  <PlusIcon aria-hidden />
                  {format(declared ? m.entryDeclare : m.entryNew)}
                </Button>
              </Shut>
            )
          )}
        </div>
      </div>

      <div {...stylex.props(styles.claims)}>
        <div
          {...stylex.props(
            styles.claimsSheet,
            granted
              ? styles.claimsSheetGranted
              : [styles.claimsSheetFilled, live.length > 0 && styles.claimsSheetTopRule],
          )}
        >
          {!granted && (
            <div {...stylex.props(styles.claimHead)}>
              <span>
                <span {...stylex.props(styles.colToLg)}>{format(m.paperColContentVersion)}</span>
                <span {...stylex.props(styles.colFromLg)}>{format(m.paperColContent)}</span>
              </span>
              <span {...stylex.props(styles.colFromLg)}>{format(m.paperColVersion)}</span>
              <span>{format(m.paperColStatus)}</span>
              <span {...stylex.props(styles.colRight)}>{format(m.paperColScore)}</span>
            </div>
          )}
          {live.length > 0 ? (
            <>
              {shown.map((entry) => (
                <ClaimRow
                  key={entry.id}
                  entry={entry}
                  item={item}
                  score={entryScore(standing, entry.id) ?? (each === undefined ? null : each)}
                  onOpen={() => onDetail(entry)}
                />
              ))}
              {live.length > 6 && (
                <button
                  type="button"
                  onClick={() => setUnfolded((now) => !now)}
                  {...stylex.props(styles.foldButton)}
                >
                  {unfolded
                    ? format(m.paperFoldLess)
                    : format(m.paperFoldMore, { count: live.length - 6 })}
                  <ChevronDownIcon
                    aria-hidden
                    className={
                      stylex.props(styles.foldIcon, unfolded && styles.foldIconOpen).className
                    }
                  />
                </button>
              )}
              {mayAdd && (
                <Shut when={shut} why={gate?.create.reason ?? null} xstyle={styles.addSeat}>
                  <button
                    type="button"
                    data-testid="file-claim"
                    data-gate={gate?.create.state ?? 'available'}
                    disabled={busy || shut}
                    onClick={add}
                    {...stylex.props(
                      styles.addRow,
                      shut ? styles.addRowShut : [styles.addRowOpen, styles.addRowOpenHoverInk],
                    )}
                  >
                    <PlusIcon aria-hidden className={stylex.props(styles.addIcon).className} />
                    {format(declared ? m.entryDeclare : m.paperEmptyFile)}
                  </button>
                </Shut>
              )}
              {full && (
                <span {...stylex.props(styles.fullNote)}>
                  {format(m.myEntriesAddFull)}
                  {item.maxEntries !== null && (
                    <span {...stylex.props(styles.nums)}>
                      {live.length} / {item.maxEntries}
                    </span>
                  )}
                </span>
              )}
            </>
          ) : (
            // why the table stands empty: never filed, or never this
            // person's to file. Staff record theirs, so the notice here
            // goes the moment the first one lands.
            <div {...stylex.props(styles.emptyTray, !granted && styles.emptyTrayFrame)}>
              <span {...stylex.props(styles.emptyBadge)}>
                {granted ? (
                  <CheckIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />
                ) : recorded ? (
                  // waiting on somebody else, which is not the same as done
                  <ClockIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />
                ) : (
                  <FileTextIcon aria-hidden className={stylex.props(styles.emptyIcon).className} />
                )}
              </span>
              <span {...stylex.props(styles.emptyTitle)}>
                {format(
                  granted
                    ? m.paperEmptyGranted
                    : recorded
                      ? m.paperEmptyRecorded
                      : m.paperEmptyTitle,
                )}
              </span>
              {mayAdd ? (
                <Shut when={shut} why={gate?.create.reason ?? null}>
                  <Button
                    data-testid="file-claim"
                    data-gate={gate?.create.state ?? 'available'}
                    size="xs"
                    variant="outline"
                    className={stylex.props(shut && styles.noPointer).className}
                    disabled={busy || shut}
                    onClick={add}
                  >
                    <PlusIcon aria-hidden />
                    {format(declared ? m.entryDeclare : m.paperEmptyFile)}
                  </Button>
                </Shut>
              ) : (
                <span {...stylex.props(styles.emptyHint)}>
                  {format(
                    voided
                      ? m.itemVoided
                      : granted
                        ? m.paperEmptyGrantedHint
                        : recorded
                          ? m.paperEmptyRecordedHint
                          : m.paperEmptyHint,
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div
      data-paper-row={row.id}
      {...stylex.props(styles.question, voided && styles.questionVoided)}
    >
      {voided ? (
        <>
          <button
            type="button"
            onClick={() => setOpened((now) => !now)}
            {...stylex.props(styles.measure, styles.voidedHead)}
          >
            <span aria-hidden {...stylex.props(styles.voidedNo)}>
              {no}.
            </span>
            <h3 {...stylex.props(styles.voidedTitle)}>{item.title}</h3>
            <span {...stylex.props(styles.voidedBadge)}>{format(m.itemsStatusVoided)}</span>
            {item.voidReason !== null && item.voidReason.trim() !== '' && (
              <span {...stylex.props(styles.voidedWhy)}>
                {format(m.paperVoidedWhy, { reason: item.voidReason })}
              </span>
            )}
            <span {...stylex.props(styles.spacer)} />
            <ChevronDownIcon
              aria-hidden
              className={
                stylex.props(styles.voidedChevron, opened && styles.foldIconOpen).className
              }
            />
          </button>
          <Appear show={opened} collapse>
            {body}
          </Appear>
        </>
      ) : (
        body
      )}
    </div>
  )
}

/**
 * One claim as one table row: enough to be told apart, and the way in.
 *
 * The cells come and go with the width - a phone folds the status and the
 * time under the content and stacks the amount over its word, a tablet
 * folds only the time - but it is one row of one list at every width, and
 * it opens the same drawer.
 */
function ClaimRow({
  entry,
  item,
  score,
  onOpen,
}: {
  entry: EntryDto
  item: ItemDto
  score: string | null
  onOpen: () => void
}) {
  const { format } = useI18n()
  const fields = fieldsOf(item.currentRevision?.formConfig)
  const payload = (entry.currentRevision?.payload ?? {}) as Record<string, unknown>
  const revisionNo = entry.currentRevision?.revisionNo
  // the shared identity line (§32.74): the item's elected fields, or the
  // first ones that identify anything - never "whatever came first"
  const parts = projectEntrySummary({
    formConfig: item.currentRevision?.formConfig,
    displayConfig: item.currentRevision?.displayConfig,
    payload,
  }).filter((part) => part.value !== '')
  const lead = parts[0]?.value ?? ''
  const sub = parts
    .slice(1)
    .map((part) => part.value)
    .join(' ')
  const ok = entry.status === 'approved'
  // how many files this claim cites, as a number rather than as the phrase
  // counting them: the drawer is where the files themselves are
  const files = fields
    .filter((field) => field.type === 'attachment')
    .reduce(
      (count, field) =>
        count + (Array.isArray(payload[field.key]) ? (payload[field.key] as unknown[]).length : 0),
      0,
    )
  const verWhen = (
    <>
      <span {...stylex.props(styles.keepShort)}>
        {entry.status === 'draft' || revisionNo === undefined
          ? format(m.paperUnsubmitted)
          : format(m.entryVersionNo, { no: revisionNo })}
      </span>
      <span {...stylex.props(styles.claimWhenClock)}>{when(entry)}</span>
    </>
  )
  return (
    <button
      type="button"
      data-testid="claim-row"
      data-files={String(files)}
      onClick={onOpen}
      {...stylex.props(styles.claimRow)}
    >
      <span {...stylex.props(styles.claimMain)}>
        <span {...stylex.props(styles.claimIdentity)}>
          <span {...stylex.props(styles.claimLead)}>{lead === '' ? item.title : lead}</span>
          {sub !== '' && <span {...stylex.props(styles.claimSub)}>{sub}</span>}
        </span>
        {/* the folded cells, under the content where the width folds them */}
        <span {...stylex.props(styles.claimFoldNarrow)}>
          <EntryStanding
            status={entry.status}
            revised={entry.currentReviewInstanceId !== null}
            asked={entry.supplement !== null}
          />
          <span {...stylex.props(styles.claimWhenNarrow)}>{verWhen}</span>
        </span>
        <span {...stylex.props(styles.claimWhenMid)}>{verWhen}</span>
      </span>
      <span {...stylex.props(styles.claimWhenWide)}>{verWhen}</span>
      <span {...stylex.props(styles.claimStandingCell)}>
        <EntryStanding
          status={entry.status}
          revised={entry.currentReviewInstanceId !== null}
          asked={entry.supplement !== null}
        />
      </span>
      {score !== null ? (
        <span {...stylex.props(styles.claimScore)}>
          <span {...stylex.props(styles.claimScoreWord)}>
            {format(
              ok
                ? m.entryScoreCounted
                : entry.status === 'in_review'
                  ? m.entryScorePending
                  : m.entryScoreIfApproved,
            )}
          </span>
          <span {...stylex.props(styles.claimScoreValue, ok && styles.claimScoreValueOk)}>
            {trimAmount(score)}
          </span>
        </span>
      ) : (
        <span />
      )}
      <ChevronRightIcon aria-hidden className={stylex.props(styles.claimChevron).className} />
    </button>
  )
}

const when = (entry: EntryDto): string =>
  new Date(entry.currentRevision?.createdAt ?? entry.createdAt).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
