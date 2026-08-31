import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { UiSlot, useApi, useApiQuery, useRunApi, useUiCollection } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { calculatorAuthoringOptions, calculatorEditorSlot } from '../../surfaces.ts'
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  EllipsisVerticalIcon,
  PlusIcon,
  TagIcon,
  XIcon,
} from 'lucide-react'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { Feedback, Field, PageHeader } from '@qualy/ui/admin'
import { useLingering } from '@qualy/ui/use-lingering'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@qualy/ui/empty'
import { Checkbox } from '@qualy/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@qualy/ui/dropdown-menu'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { materializeField, type FieldDraft as ValueDraft } from '@qualy/web-value-form/model'
import type { AtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'
import { ScoringBindingEditor } from './ScoringBindingEditor.tsx'
import { assessmentApi } from '../api.ts'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { SUMMARY_FIELDS_MOST, summaryFieldIdsOf } from '../../entry/summary.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { amountOf, trimAmount, unitsOf, type ItemDto } from '../entry/model.ts'
import { Choice } from './Choice.tsx'
import { FieldList, type FieldDraft } from './FieldTable.tsx'
import { StageSheet, type StageDraft } from './StageSheet.tsx'
import { ImpactDialog, type ChangeEffects, type ChangeImpact } from './ImpactDialog.tsx'
import { ReasonDialog } from './ReasonDialog.tsx'
import { BatchBanner } from '../batch/BatchScreen.tsx'
import type { ItemOptions } from './options.ts'
import type { Placement } from './paper.ts'
import { countedEntries, type Folding } from './structure.ts'

const sm = '@media (min-width: 640px)'
const md = '@media (min-width: 768px)'
const xl = '@media (min-width: 1280px)'

const styles = stylex.create({
  field: { width: 176 },
  figure: { fontVariantNumeric: 'tabular-nums' },
  unitTail: {
    fontSize: 12,
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
  },
  // shared scraps
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  shrinkNone: {
    flexShrink: 0,
  },
  minWidth0: {
    minWidth: 0,
  },
  inlineFlex: {
    display: 'inline-flex',
  },
  fullWidth: {
    width: '100%',
  },
  truncateMin: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tabular: {
    fontVariantNumeric: 'tabular-nums',
  },
  icon12: {
    width: 12,
    height: 12,
  },
  icon14: {
    width: 14,
    height: 14,
  },
  icon16: {
    width: 16,
    height: 16,
  },
  smallMuted: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  smallProse: {
    fontSize: 12,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  mutedText: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  subheading: {
    fontSize: 14,
    fontWeight: 500,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  mutedControl: {
    color: tokens.mutedForeground,
  },
  // the summary picker
  summaryRoot: {
    display: 'flex',
    maxWidth: '42rem',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
  },
  chosenHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  chosenLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  chosenCount: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  emptySeat: {
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
    padding: 24,
  },
  emptyHeadGap: {
    gap: 6,
  },
  emptyMediaSize: {
    marginBottom: 4,
    width: 32,
    height: 32,
    borderRadius: tokens.radiusLg,
  },
  emptyTitleText: {
    fontSize: 14,
    fontWeight: 500,
  },
  emptyDescText: {
    fontSize: 12,
    lineHeight: 1.625,
  },
  chosenList: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  chosenRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
    },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
    paddingBlock: 6,
    paddingRight: 8,
    paddingLeft: 6,
    userSelect: 'none',
  },
  rowMarkBefore: {
    boxShadow: `inset 0 2px 0 0 ${tokens.primary}`,
  },
  rowMarkAfter: {
    boxShadow: `inset 0 -2px 0 0 ${tokens.primary}`,
  },
  handle: {
    flexShrink: 0,
    cursor: {
      default: 'grab',
      ':active': 'grabbing',
    },
    paddingInline: 2,
    paddingBlock: 4,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  ordinal: {
    display: 'flex',
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    backgroundColor: tokens.foreground,
    fontSize: 10,
    fontWeight: 600,
    color: tokens.background,
    fontVariantNumeric: 'tabular-nums',
  },
  rowName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 500,
  },
  rowType: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  leadTag: {
    flexShrink: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 6,
    paddingBlock: 2,
    fontSize: 10,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  othersRow: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 6,
  },
  othersLabel: {
    paddingRight: 2,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  addKey: {
    display: 'inline-flex',
    height: 28,
    alignItems: 'center',
    gap: 4,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
    paddingInline: 10,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  addKeyFull: {
    cursor: 'not-allowed',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  addKeyOpen: {
    cursor: 'pointer',
    color: tokens.foreground,
    transitionProperty: 'color, background-color, border-color, box-shadow',
    borderStyle: {
      default: 'dashed',
      ':hover': 'solid',
    },
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  capNote: {
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  // the editor's own frame
  editorRoot: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  backButton: {
    flexShrink: 0,
    transitionProperty: 'color, background-color, border-color, box-shadow',
    color: {
      default: null,
      ':hover': tokens.foreground,
    },
  },
  trailSep: {
    paddingInline: 6,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  trailDot: {
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  menuButton: {
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  layout: {
    display: 'grid',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    columnGap: 36,
    gridTemplateColumns: {
      default: null,
      [xl]: 'minmax(0, 1fr) 19.5rem',
    },
  },
  mainColumn: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  problemSeat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingTop: 16,
  },
  issueList: {
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.danger} 40%, transparent)`,
    padding: 12,
    fontSize: 14,
    color: tokens.danger,
  },
  fieldColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  pairGrid: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: {
      default: null,
      [sm]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  statBand: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 14,
    paddingBlock: 12,
  },
  statCell: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 2,
  },
  statLabel: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  statValue: {
    fontSize: 16,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  divider: {
    height: 28,
    width: 1,
    backgroundColor: tokens.border,
  },
  scoringRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 20,
  },
  w96: {
    width: 96,
  },
  w112: {
    width: 112,
  },
  w152: {
    width: 152,
  },
  w208: {
    width: 208,
  },
  w240: {
    width: 240,
  },
  inlineRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  anyLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  reviewColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  escalationBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 16,
  },
  subhint: {
    paddingTop: 2,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  escalationEmptyRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 16,
    fontSize: 12,
    fontWeight: 500,
  },
  quietNote: {
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
  aside: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    paddingBlock: 24,
  },
  asidePanel: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    backgroundColor: tokens.surfaceMuted,
    padding: 16,
  },
  // the kind cards
  kindRoot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  kindGrid: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: {
      default: null,
      [sm]: 'repeat(3, minmax(0, 1fr))',
    },
  },
  kindCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 12,
    textAlign: 'left',
    transitionProperty: 'color, background-color, border-color, box-shadow',
  },
  kindCardRest: {
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    },
  },
  kindCardChosen: {
    borderColor: tokens.foreground,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
  },
  kindCardLocked: {
    cursor: 'default',
    opacity: 0.7,
  },
  kindCardLockedChosen: {
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
      ':hover': 'transparent',
    },
  },
  kindHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  kindDot: {
    display: 'flex',
    width: 14,
    height: 14,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
  },
  kindDotChosen: {
    borderColor: tokens.foreground,
  },
  kindDotRest: {
    borderColor: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  kindDotFill: {
    width: 6,
    height: 6,
    borderRadius: '9999px',
    backgroundColor: tokens.foreground,
  },
  kindName: {
    fontSize: 14,
  },
  kindNameChosen: {
    fontWeight: 600,
  },
  kindHint: {
    fontSize: 12,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  // one part of the question
  section: {
    display: 'grid',
    columnGap: 28,
    rowGap: 16,
    borderTopWidth: {
      default: 1,
      ':first-of-type': 0,
    },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingBlock: 24,
    gridTemplateColumns: {
      default: null,
      [md]: '10.5rem minmax(0, 1fr)',
    },
  },
  sectionWords: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  // the standing chip
  chip: {
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 10,
    paddingBlock: 2,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  chipItems: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '9999px',
  },
  statusDotActive: {
    backgroundColor: tokens.foreground,
  },
  statusDotIdle: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  inlineAdd: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transitionProperty: 'color, background-color, border-color, box-shadow',
    color: {
      default: null,
      ':hover': tokens.mutedForeground,
    },
  },
  // the chain, drawn as markers over labels
  chainScroll: {
    marginInline: -4,
    overflowX: 'auto',
    paddingInline: 4,
    paddingBottom: 4,
  },
  chainGrid: {
    display: 'grid',
    width: 'max-content',
  },
  markRow: {
    display: 'flex',
    alignItems: 'center',
  },
  labelCell: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
    paddingTop: 8,
    paddingRight: 24,
  },
  startDot: {
    width: 6,
    height: 6,
    borderRadius: '9999px',
    backgroundColor: tokens.mutedForeground,
  },
  gapSeat: {
    position: 'relative',
    display: 'flex',
    height: 24,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
  },
  gapLine: {
    height: 1,
    width: '100%',
    backgroundColor: tokens.border,
  },
  gapAdd: {
    position: 'absolute',
    left: '50%',
    display: 'flex',
    width: 20,
    height: 20,
    transform: 'translateX(-50%)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: {
      default: 'dashed',
      ':hover': 'solid',
      ':focus-visible': 'solid',
    },
    borderColor: {
      default: tokens.border,
      ':hover': `color-mix(in oklab, ${tokens.foreground} 50%, transparent)`,
    },
    backgroundColor: tokens.background,
    color: {
      default: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
      ':hover': tokens.foreground,
      ':focus-visible': tokens.foreground,
    },
    transitionProperty: 'color, background-color, border-color, box-shadow',
  },
  marker: {
    display: 'flex',
    width: 24,
    height: 24,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    color: tokens.mutedForeground,
  },
  stageMark: {
    display: 'flex',
    width: 24,
    height: 24,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    fontSize: 12,
    fontWeight: 500,
  },
  stageMarkDone: {
    backgroundColor: tokens.foreground,
    color: tokens.background,
  },
  stageMarkUnset: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `color-mix(in oklab, ${tokens.danger} 60%, transparent)`,
    color: tokens.danger,
  },
  stepRoot: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
  },
  stepName: {
    minWidth: 0,
    textAlign: 'left',
    fontSize: 14,
    fontWeight: 500,
    overflowWrap: 'break-word',
    textUnderlineOffset: 4,
    textDecorationLine: {
      default: 'none',
      ':hover': 'underline',
    },
  },
  stepNameBad: {
    color: tokens.danger,
  },
  stepWho: {
    fontSize: 12,
    overflowWrap: 'break-word',
    color: tokens.mutedForeground,
  },
  stepControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    paddingTop: 2,
  },
  coverageNote: {
    fontSize: 12,
  },
  coverageBad: {
    color: tokens.danger,
  },
  coverageOk: {
    color: tokens.mutedForeground,
  },
  // the aside: preview, placement, versions
  previewTitle: {
    paddingBottom: 12,
    fontSize: 12,
    fontWeight: 600,
  },
  previewCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.background,
    padding: 14,
  },
  declarePill: {
    display: 'inline-flex',
    height: 32,
    width: 'fit-content',
    alignItems: 'center',
    borderRadius: `calc(${tokens.radiusLg} * 2.6)`,
    backgroundColor: tokens.primary,
    paddingInline: 14,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.primaryForeground,
  },
  previewFields: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  previewField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  requiredStar: {
    paddingLeft: 2,
    color: tokens.danger,
  },
  uploadBox: {
    display: 'flex',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  inputBox: {
    height: 36,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  asideTitle: {
    fontSize: 12,
    fontWeight: 600,
  },
  placedBlock: {
    marginTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 14,
  },
  versionsBlock: {
    marginTop: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 14,
  },
  amountRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    fontSize: 12,
  },
  amountLabel: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  amountValue: {
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
  },
})

/**
 * The row's own picture, carried under the pointer.
 *
 * The editor animates in a transformed panel, and a drag image taken from
 * inside one is snapshotted off that whole layer - the browser hands back
 * a picture of the screen instead of the row. A copy parked on the body
 * has no transformed ancestor, so what lifts is the row and nothing else.
 */
const liftGhost = (event: React.DragEvent<HTMLElement>) => {
  const row = event.currentTarget
  const box = row.getBoundingClientRect()
  const ghost = row.cloneNode(true) as HTMLElement
  ghost.style.position = 'fixed'
  ghost.style.top = '-1000px'
  ghost.style.left = '-1000px'
  ghost.style.width = `${String(box.width)}px`
  ghost.style.pointerEvents = 'none'
  // dressed by hand: a clone parked on the body is outside every compiled
  // stylesheet's reach, so the lifted look is written straight onto it
  ghost.style.borderRadius = '10px'
  ghost.style.border = '1px solid var(--q-border)'
  ghost.style.background = 'var(--q-background)'
  ghost.style.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
  document.body.append(ghost)
  event.dataTransfer.setDragImage(ghost, event.clientX - box.left, box.height / 2)
  // the browser has taken its picture by the next frame
  requestAnimationFrame(() => ghost.remove())
}

/**
 * Which fields identify a claim, in order (§32.74): up to three, the
 * first is the claim's title. The chosen rows read as the line a list
 * will show and drag to reorder with the field list's own handles; every
 * other field stands beside them as a key that adds it. Attachments are
 * absent because a file count names no claim, and the cap is stated
 * rather than only enforced.
 */
function SummaryPicker({
  fields,
  elected,
  onChange,
}: {
  fields: readonly FieldDraft[]
  elected: readonly string[]
  onChange: (next: string[]) => void
}) {
  const { format } = useI18n()
  const [drop, setDrop] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  /** the row whose handle is under the pointer, and so the row that may drag */
  const [held, setHeld] = useState<string | null>(null)
  const eligible = fields.filter((field) => field.type !== 'attachment' && field.id !== '')
  // a field deleted from the form quietly leaves the election too
  const chosen = elected.filter((id) => eligible.some((field) => field.id === id))
  const remaining = eligible.filter((field) => !chosen.includes(field.id))
  const full = chosen.length >= SUMMARY_FIELDS_MOST
  const nameOf = (field: FieldDraft) =>
    field.label.trim() !== '' ? field.label : format(m.itemsFieldUnnamed)
  const edgeOf = (event: React.DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY < box.top + box.height / 2 ? ('before' as const) : ('after' as const)
  }
  const move = (dragged: string, target: string, edge: 'before' | 'after') => {
    if (dragged === target) return
    const order = chosen.filter((id) => id !== dragged)
    const at = order.indexOf(target)
    order.splice(edge === 'before' ? at : at + 1, 0, dragged)
    onChange(order)
  }
  return (
    <div {...stylex.props(styles.summaryRoot)}>
      {chosen.length > 0 && (
        <div {...stylex.props(styles.chosenHead)}>
          <p {...stylex.props(styles.chosenLabel)}>{format(m.itemsSummaryChosen)}</p>
          <span {...stylex.props(styles.spacer)} />
          <p {...stylex.props(styles.chosenCount)}>
            {format(m.itemsSummaryCount, { count: chosen.length, most: SUMMARY_FIELDS_MOST })}
          </p>
        </div>
      )}

      {chosen.length === 0 ? (
        <Empty xstyle={styles.emptySeat}>
          <EmptyHeader xstyle={styles.emptyHeadGap}>
            <EmptyMedia variant="icon" xstyle={styles.emptyMediaSize}>
              <TagIcon className={stylex.props(styles.icon16).className} />
            </EmptyMedia>
            <EmptyTitle xstyle={styles.emptyTitleText}>
              {format(m.itemsSummaryEmptyTitle)}
            </EmptyTitle>
            <EmptyDescription xstyle={styles.emptyDescText}>
              {format(m.itemsSummaryFallback)}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul {...stylex.props(styles.chosenList)}>
          {chosen.map((id, index) => {
            const field = eligible.find((one) => one.id === id)!
            const marked = drop?.id === id ? drop.edge : null
            return (
              <li
                key={id}
                // only the handle starts a drag, and the ghost is pinned to
                // this row: left to the browser the snapshot took in
                // whatever box it found around the flex child
                draggable={held === id}
                onDragStart={(event) => {
                  event.dataTransfer.setData('qualy/summary-field', id)
                  event.dataTransfer.effectAllowed = 'move'
                  liftGhost(event)
                }}
                onDragEnd={() => {
                  setHeld(null)
                  setDrop(null)
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes('qualy/summary-field')) return
                  event.preventDefault()
                  setDrop({ id, edge: edgeOf(event) })
                }}
                onDragLeave={() => setDrop((mark) => (mark?.id === id ? null : mark))}
                onDrop={(event) => {
                  event.preventDefault()
                  setDrop(null)
                  const dragged = event.dataTransfer.getData('qualy/summary-field')
                  if (dragged !== '') move(dragged, id, edgeOf(event))
                }}
                {...stylex.props(
                  styles.chosenRow,
                  marked === 'before' && styles.rowMarkBefore,
                  marked === 'after' && styles.rowMarkAfter,
                )}
              >
                <span
                  aria-hidden
                  onPointerDown={() => setHeld(id)}
                  onPointerUp={() => setHeld(null)}
                  {...stylex.props(styles.handle)}
                >
                  <GripVerticalIcon className={stylex.props(styles.icon14).className} />
                </span>
                <span {...stylex.props(styles.ordinal)}>{index + 1}</span>
                <span {...stylex.props(styles.rowName)}>{nameOf(field)}</span>
                <span {...stylex.props(styles.rowType)}>
                  {format(SUMMARY_TYPE_LABEL[field.type])}
                </span>
                {index === 0 && (
                  <span {...stylex.props(styles.leadTag)}>{format(m.itemsSummaryLead)}</span>
                )}
                <span {...stylex.props(styles.spacer)} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={stylex.props(styles.shrinkNone).className}
                  onClick={() => onChange(chosen.filter((one) => one !== id))}
                >
                  <XIcon aria-hidden />
                  <VisuallyHidden>{format(m.itemsSummaryRemove)}</VisuallyHidden>
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {remaining.length > 0 && (
        <div {...stylex.props(styles.othersRow)}>
          <span {...stylex.props(styles.othersLabel)}>{format(m.itemsSummaryOthers)}</span>
          {remaining.map((field) => (
            <button
              key={field.id}
              type="button"
              disabled={full}
              onClick={() => onChange([...chosen, field.id])}
              {...stylex.props(styles.addKey, full ? styles.addKeyFull : styles.addKeyOpen)}
            >
              <PlusIcon aria-hidden className={stylex.props(styles.icon12).className} />
              {nameOf(field)}
            </button>
          ))}
        </div>
      )}

      {full && (
        <p {...stylex.props(styles.capNote)}>
          {format(m.itemsSummaryCapFull, { most: SUMMARY_FIELDS_MOST })}
        </p>
      )}
    </div>
  )
}

const SUMMARY_TYPE_LABEL = {
  text: m.itemsTypeText,
  date: m.itemsTypeDate,
  integer: m.itemsTypeInteger,
  decimal: m.itemsTypeDecimal,
  choice: m.itemsTypeChoice,
  attachment: m.itemsTypeAttachment,
} as const

const blankField = (key: string): FieldDraft => ({
  // minted together and both immutable: the key is where the answer sits,
  // the id is what says this is still the same question next revision
  id: key,
  key,
  type: 'text',
  label: '',
  required: false,
  maxLength: '',
})

/**
 * A step's permanent name. Saved with the policy, because whether an
 * in-flight round can carry on under a newer one is answered by asking
 * whether the step it stands at is still there - a question positions
 * cannot answer, and a handle minted fresh on every load answers wrongly.
 */
const nextStageId = (): string =>
  `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const blankStage = (options: ItemOptions, chain: 'normal' | 'escalation'): StageDraft => ({
  key: nextStageId(),
  label: '',
  kind: 'roleAt',
  nodeTypeId: options.orgTypes[0]?.id ?? '',
  roleIds: [],
  roleId: options.roles[0]?.id ?? '',
  participation: 'any',
  chain,
})

// One question, composed rather than typed: the fields participants will
// fill, what each approved entry counts, and who reviews at which level.
// The editor builds the same configuration object the api validates, so the
// server stays the judge and this stays a pen.
//
// The review chain is drawn as what it is - a path from submission to a
// finished review - with one step open for editing at a time and the rest
// folded to what they resolve to.

/**
 * The key is the payload's own word for a field, so it is minted once and
 * never reused: renaming one would leave every filed answer pointing at a
 * field that no longer exists. Nobody types it - the label is what a person
 * writes.
 *
 * Not a counter. `f1` is a name the next question of the next round would
 * mint as well, and a name two different questions answer to is the one
 * thing a permanent identity may not be.
 */
const nextKey = (): string => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export interface Draft {
  title: string
  scoreGroupId: string
  maxEntries: string
  /** what kind of question this is; frozen once created */
  itemType: 'evidence' | 'declaration' | 'constant'
  entrySource: 'student' | 'administrative'
  /** whether submissions answer to a review route at all */
  reviewMode: 'workflow' | 'none'
  description: string
  /** the fields elected to identify a claim, in order (§32.74) */
  summaryFieldIds: string[]
  fields: FieldDraft[]
  fixedValue: string
  /** how approved lines fold into the item's amount */
  folding: 'sum' | 'max' | 'top-n'
  topN: string
  /**
   * The scoring LANGUAGE this question was read under, and - for the
   * versioned one - the stored configuration exactly as the server sent it.
   *
   * A versioned configuration says things this pen cannot yet author:
   * recognitions with their identities, parameter bindings, refinements
   * narrowing what a reviewer may determine. Rebuilding it out of the two
   * fields the pen does hold would not "lose formatting" - it would delete
   * the question's arithmetic and quietly store a different one. So until
   * somebody actually edits the scoring, a versioned question is saved back
   * as the bytes it arrived as.
   */
  scoring: ScoringDraft
  stages: StageDraft[]
}

/** the stored versioned language, carried whole */
export interface StoredScoringV2 {
  version: 2
  calculator: { ref: string; config: unknown }
  aggregator: { ref: string; config: unknown }
  recognitions: Record<
    string,
    { label: string; refinement: unknown; defaultFromFieldId: string | null }
  >
  bindings: Record<string, unknown>
}

/**
 * One recognised fact as this pen holds it.
 *
 * `id` is the server's identity when the fact already has one, and null
 * while it is still being composed - a new recognition is addressed by its
 * handle until a save mints it one. `refinement` is never authored here:
 * it narrows what the fact may be, this build has no control for it, and
 * carrying it opaquely is the difference between renaming a fact and
 * quietly widening it.
 */
export interface RecognitionDraft {
  id: string | null
  label: string
  refinement: unknown
  defaultFromFieldId: string | null
}

/**
 * What feeds one of the calculator's parameters.
 *
 * A constant keeps BOTH the stored value and the edit in progress: an
 * untouched one travels back exactly as it arrived, so opening a question
 * and saving it moves no byte, and only a value somebody actually typed
 * goes through the value form's own materialization.
 */
export type BindingDraft =
  { kind: 'constant'; value: unknown; draft?: ValueDraft } | { kind: 'recognition'; handle: string }

export type ScoringDraft =
  /** the legacy language: the pen's own three fields are the whole truth */
  | { language: 'v1' }
  /**
   * The versioned language. `original` is what the server stored, byte for
   * byte - null for a question this pen upgraded, which has no stored V2
   * yet. `calculator` is the part the chosen calculator's own editor owns,
   * and is only written back once that editor has actually changed it. The
   * folding rule is not here because it was always this pen's own field.
   *
   * Recognitions are keyed by HANDLE, which for an existing fact is its own
   * identity: the draft language addresses them by handle, and reusing the
   * id spares this pen a second name for the same thing.
   */
  | {
      language: 'v2'
      original: StoredScoringV2 | null
      calculator: { ref: string; config: unknown }
      recognitions: Record<string, RecognitionDraft>
      bindings: Record<string, BindingDraft>
      touched: boolean
    }
  /**
   * A language written by a newer build than this one.
   *
   * There is nothing honest to do with it but carry it: reading it as the
   * legacy language would let a rename rebuild it as a fixed amount, which
   * is the exact silent rewrite this whole model exists to prevent. The
   * scoring controls are closed while it is on screen, and everything else
   * about the question stays editable.
   */
  | { language: 'unsupported'; original: unknown; version: unknown }

/**
 * Which scoring language a stored configuration is written in.
 *
 * The version key is the whole test, read as an own property before any
 * shape is assumed - exactly as the server's own reader dispatches. A
 * configuration that says version 2 is carried whole; anything else is the
 * legacy language, which this pen has always rebuilt from its own fields.
 */
const scoringDraftOf = (stored: unknown): ScoringDraft => {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    return { language: 'v1' }
  }
  if (!Object.hasOwn(stored, 'version')) return { language: 'v1' }
  const version = (stored as { version?: unknown }).version
  if (version !== 2) return { language: 'unsupported', original: stored, version }
  const original = stored as unknown as StoredScoringV2
  return {
    language: 'v2',
    original,
    calculator: original.calculator,
    // the stored form is keyed by identity; the draft form by handle, and
    // an existing fact's handle is that identity
    recognitions: Object.fromEntries(
      Object.entries(original.recognitions ?? {}).map(([id, one]) => [
        id,
        {
          id,
          label: one.label,
          refinement: one.refinement,
          defaultFromFieldId: one.defaultFromFieldId,
        },
      ]),
    ),
    bindings: Object.fromEntries(
      Object.entries(original.bindings ?? {}).map(([parameter, binding]) => {
        const held = binding as { kind?: unknown; value?: unknown; recognitionId?: unknown }
        return [
          parameter,
          held.kind === 'recognition'
            ? { kind: 'recognition' as const, handle: String(held.recognitionId) }
            : { kind: 'constant' as const, value: held.value },
        ]
      }),
    ),
    touched: false,
  }
}

/** the stored configuration back into the pen; a shape this pen cannot hold starts fresh */
const draftOf = (
  item: ItemDto | null,
  groups: readonly { id: string }[],
  options: ItemOptions,
): Draft => {
  const revision = item?.currentRevision ?? null
  const config = revision as {
    entrySource?: 'student' | 'administrative'
    formConfig?: unknown
    scoringConfig?: unknown
    reviewPolicy?: unknown
    displayConfig?: unknown
  } | null
  const fields = Array.isArray((config?.formConfig as { fields?: unknown[] })?.fields)
    ? ((config!.formConfig as { fields: Record<string, unknown>[] }).fields.map(
        (field): FieldDraft => {
          // a form saved before identities existed is not rewritten to gain
          // them: its key is its identity, which is what it always was
          const base = {
            id: String(field['id'] ?? field['key'] ?? ''),
            key: String(field['key'] ?? ''),
            label: String(field['label'] ?? ''),
            required: field['required'] === true,
          }
          const type = (field['type'] as FieldDraft['type']) ?? 'text'
          switch (type) {
            case 'date':
              return {
                ...base,
                type,
                min: String(field['min'] ?? ''),
                max: String(field['max'] ?? ''),
              }
            case 'integer':
              return {
                ...base,
                type,
                min: field['min'] === undefined ? '' : String(field['min']),
                max: field['max'] === undefined ? '' : String(field['max']),
              }
            case 'decimal':
              return {
                ...base,
                type,
                maxScale: field['maxScale'] === undefined ? '2' : String(field['maxScale']),
                min: String(field['min'] ?? ''),
                max: String(field['max'] ?? ''),
              }
            case 'choice':
              return {
                ...base,
                type,
                options: Array.isArray(field['options'])
                  ? (field['options'] as Record<string, unknown>[]).map((option) => ({
                      value: String(option['value'] ?? ''),
                      label: String(option['label'] ?? ''),
                    }))
                  : [],
              }
            case 'attachment':
              return {
                ...base,
                type,
                maxCount: field['maxCount'] === undefined ? '1' : String(field['maxCount']),
                maxSizeMb:
                  field['maxFileBytes'] === undefined
                    ? ''
                    : String(Math.round(Number(field['maxFileBytes']) / (1024 * 1024))),
                accept: Array.isArray(field['accept'])
                  ? (field['accept'] as string[]).join(', ')
                  : '',
              }
            default:
              return {
                ...base,
                type: 'text',
                maxLength: field['maxLength'] === undefined ? '' : String(field['maxLength']),
              }
          }
        },
      ) ?? [])
    : []
  const scoring = config?.scoringConfig as
    | {
        calculator?: { config?: { value?: string } }
        aggregator?: { ref?: string; config?: { n?: number } }
      }
    | undefined
  const scoringLanguage = scoringDraftOf(config?.scoringConfig)
  const aggregatorRef = scoring?.aggregator?.ref ?? 'sum@1'
  const stages = stagesOf(config?.reviewPolicy, options)
  return {
    title: item?.title ?? '',
    scoreGroupId:
      item !== null && item.scoreGroupId !== '' ? item.scoreGroupId : (groups[0]?.id ?? ''),
    maxEntries: item === null ? '1' : item.maxEntries === null ? '' : String(item.maxEntries),
    itemType:
      item?.itemType === 'constant'
        ? 'constant'
        : item?.itemType === 'declaration'
          ? 'declaration'
          : 'evidence',
    entrySource: config?.entrySource ?? 'student',
    reviewMode:
      item?.itemType === 'constant' ||
      (config?.reviewPolicy as { mode?: unknown } | undefined)?.mode === 'none'
        ? 'none'
        : 'workflow',
    description: String((config?.displayConfig as { description?: unknown })?.description ?? ''),
    summaryFieldIds: summaryFieldIdsOf(config?.displayConfig).filter((id) =>
      fields.some((field) => field.id === id),
    ),
    fields: fields.length > 0 ? fields : [blankField(nextKey())],
    // 100.0000 is how it is stored, not how anybody types it
    fixedValue: trimAmount(scoring?.calculator?.config?.value ?? '1'),
    folding: aggregatorRef === 'max@1' ? 'max' : aggregatorRef === 'top-n-sum@1' ? 'top-n' : 'sum',
    topN: String(scoring?.aggregator?.config?.n ?? 2),
    scoring: scoringLanguage,
    stages: stages.length > 0 ? stages : [blankStage(options, 'normal')],
  }
}

/**
 * The stored policy back into the pen, whichever version wrote it.
 *
 * A policy written as one list with `normalTerminal` in it is read as the
 * split it always described, and its steps keep the names they are known by
 * elsewhere - the same names the round rows were backfilled with - so
 * opening an old question in the editor does not silently rebuild its
 * policy out of new steps.
 */
const stagesOf = (stored: unknown, options: ItemOptions): StageDraft[] => {
  const held = stored as
    | {
        normal?: { stages?: StoredStage[] }
        escalation?: { stages?: StoredStage[] }
        /** the escalation route while it was still called the doubt route */
        doubt?: { stages?: StoredStage[] }
        stages?: StoredStage[]
        normalTerminal?: number
      }
    | undefined
  const other = held?.escalation ?? held?.doubt
  const draftOne = (stage: StoredStage, chain: 'normal' | 'escalation', id: string): StageDraft =>
    stage.selector?.kind === 'nearestRole'
      ? {
          key: id,
          label: stage.label ?? '',
          kind: 'nearestRole',
          nodeTypeId: options.orgTypes[0]?.id ?? '',
          roleIds: [],
          roleId: stage.selector.roleId ?? options.roles[0]?.id ?? '',
          participation: stage.quorum?.type === 'all' ? 'all' : 'any',
          chain,
        }
      : {
          key: id,
          label: stage.label ?? '',
          kind: 'roleAt',
          nodeTypeId: stage.selector?.nodeTypeId ?? options.orgTypes[0]?.id ?? '',
          roleIds: stage.selector?.roleIds ?? [],
          roleId: options.roles[0]?.id ?? '',
          participation: stage.quorum?.type === 'all' ? 'all' : 'any',
          chain,
        }
  if (Array.isArray(held?.normal?.stages) || Array.isArray(other?.stages)) {
    return [
      ...(held?.normal?.stages ?? []).map((stage, index) =>
        draftOne(stage, 'normal', stage.id ?? `legacy-${index}`),
      ),
      ...(other?.stages ?? []).map((stage, index) =>
        draftOne(stage, 'escalation', stage.id ?? `legacy-${index}`),
      ),
    ]
  }
  const terminal = held?.normalTerminal ?? 0
  return (held?.stages ?? []).map((stage, index) =>
    draftOne(stage, index > terminal ? 'escalation' : 'normal', stage.id ?? `legacy-${index}`),
  )
}

interface StoredStage {
  id?: string
  label?: string
  selector?: { kind?: string; nodeTypeId?: string; roleIds?: string[]; roleId?: string }
  quorum?: { type?: string }
}

const storedStage = (stage: StageDraft, panelable: boolean) => ({
  id: stage.key,
  ...(stage.label.trim() !== '' ? { label: stage.label.trim() } : {}),
  selector:
    stage.kind === 'roleAt'
      ? { kind: 'roleAt', nodeTypeId: stage.nodeTypeId, roleIds: stage.roleIds }
      : { kind: 'nearestRole', roleId: stage.roleId },
  // a panel only where the server allows one: an escalation middle step. A
  // step dragged to the route's end quietly folds back to a single judge
  // rather than saving a configuration the api would refuse.
  quorum: { type: panelable && stage.participation === 'all' ? 'all' : 'any' },
})

/**
 * The scoring half of a save, in the language the question is written in.
 *
 * A pristine versioned configuration goes back exactly as it came: the pen
 * cannot yet author recognitions, bindings or refinements, and a save that
 * rebuilt them out of what it can see would be storing a different
 * question. Only an actual scoring edit gives this pen the right to write
 * the versioned language itself - and that arrives with the binding editor.
 */
/** the folding rules this editor owns; an aggregator outside them belongs
 *  to whoever wrote it, and is carried rather than rebuilt */
const OWN_AGGREGATORS = new Set(['sum@1', 'max@1', 'top-n-sum@1'])

/**
 * The versioned scoring the pen would submit, as the DRAFT language.
 *
 * Recognitions go out as an array addressed by handle, because a fact
 * composed here has no identity until the server mints one; an existing
 * fact carries its id beside its handle so the save knows it is the same
 * fact renamed rather than a new one. Constants nobody edited carry the
 * value that was stored, byte for byte - materialization is for values a
 * person actually typed.
 */
const draftScoringOf = (
  scoring: Extract<ScoringDraft, { language: 'v2' }>,
  aggregator: { ref: string; config: unknown },
  schemaOf: (parameter: string) => AtomicSchema | undefined,
) => ({
  version: 2,
  calculator: scoring.calculator,
  aggregator,
  recognitions: Object.entries(scoring.recognitions).map(([handle, one]) => ({
    handle,
    ...(one.id === null ? {} : { id: one.id }),
    label: one.label,
    refinement: (one.refinement ?? null) as unknown,
    defaultFromFieldId: one.defaultFromFieldId,
  })),
  bindings: Object.fromEntries(
    Object.entries(scoring.bindings).map(([parameter, binding]) => {
      if (binding.kind === 'recognition') {
        return [parameter, { kind: 'recognition' as const, handle: binding.handle }]
      }
      if (binding.draft === undefined) {
        return [parameter, { kind: 'constant' as const, value: binding.value }]
      }
      // a value that will not materialize travels as what was typed: the
      // save gate holds it back, and a caller who gets past that meets the
      // server's own refusal by name rather than a missing key
      const schema = schemaOf(parameter)
      const outcome = schema === undefined ? undefined : materializeField(schema, binding.draft)
      return [
        parameter,
        {
          kind: 'constant' as const,
          value: outcome?.kind === 'value' ? outcome.value : binding.draft,
        },
      ]
    }),
  ),
})

const scoringOf = (
  draft: Draft,
  aggregator: { ref: string; config: unknown },
  schemaOf: (parameter: string) => AtomicSchema | undefined = () => undefined,
) => {
  // a language from a newer build travels whole, always
  if (draft.scoring.language === 'unsupported') return draft.scoring.original
  if (draft.scoring.language === 'v2') {
    const { original, calculator, touched } = draft.scoring
    // the folding rule has always been this pen's field: the select above
    // reads it and writes it, so a versioned question whose aggregator this
    // editor understands is written from the pen. One it does not
    // understand it carries.
    const folding =
      original === null || OWN_AGGREGATORS.has(original.aggregator.ref)
        ? aggregator
        : original.aggregator
    // nothing about the arithmetic was touched: the stored form goes back
    // exactly as it came, which the server treats as the no-op it is
    if (!touched && original !== null) {
      return { ...original, aggregator: folding }
    }
    return draftScoringOf({ ...draft.scoring, calculator }, folding, schemaOf)
  }
  return {
    calculator: { ref: 'fixed@1', config: { value: draft.fixedValue.trim() } },
    aggregator,
  }
}

/**
 * The pen back into the configuration the api validates.
 *
 * `schemaOf` answers what type a calculator parameter takes, which only the
 * compiled contract knows. Without it a constant somebody typed cannot be
 * turned into a wire value - so the caller that has the contract passes it,
 * and the ones that only need the shape (change detection before it
 * arrives) do not.
 */
const configOf = (draft: Draft, schemaOf?: (parameter: string) => AtomicSchema | undefined) =>
  draft.itemType === 'declaration'
    ? {
        // one press is the whole filing: no fields, review as configured
        entrySource: draft.entrySource,
        formConfig: {},
        scoringConfig: scoringOf(draft, aggregatorOf(draft), schemaOf),
        ...displayConfigOf(draft, false),
        reviewPolicy: reviewPolicyOf(draft),
      }
    : draft.itemType === 'constant'
      ? {
          // granted, never filed: no form, no route, only the amount
          entrySource: 'administrative' as const,
          formConfig: {},
          scoringConfig: scoringOf(draft, { ref: 'sum@1', config: {} }, schemaOf),
          ...displayConfigOf(draft, false),
          reviewPolicy: { mode: 'none' },
        }
      : evidenceConfigOf(draft, schemaOf)

/** the rule the pen holds, before it is an aggregator reference */
const foldingOf = (draft: Draft): Folding =>
  draft.folding === 'max'
    ? { rule: 'max' }
    : draft.folding === 'top-n'
      ? { rule: 'top-n', n: Math.max(1, Number(draft.topN) || 1) }
      : { rule: 'sum' }

// read through foldingOf so the ceiling the panel prints and the rule the
// scorer is given can only ever be the same rule
const aggregatorOf = (draft: Draft) => {
  const folding = foldingOf(draft)
  return folding.rule === 'max'
    ? { ref: 'max@1', config: {} }
    : folding.rule === 'top-n'
      ? { ref: 'top-n-sum@1', config: { n: folding.n } }
      : { ref: 'sum@1', config: {} }
}

const reviewPolicyOf = (draft: Draft) => {
  if (draft.reviewMode === 'none') return { mode: 'none' }
  const escalation = draft.stages.filter((one) => one.chain === 'escalation')
  return {
    normal: {
      stages: draft.stages
        .filter((one) => one.chain === 'normal')
        .map((one) => storedStage(one, false)),
    },
    escalation: {
      stages: escalation.map((one, index) => storedStage(one, index < escalation.length - 1)),
    },
  }
}

const displayConfigOf = (draft: Draft, withSummary: boolean) => {
  const description = draft.description.trim()
  const elected = withSummary
    ? draft.summaryFieldIds.filter((id) =>
        draft.fields.some((field) => field.id === id && field.type !== 'attachment'),
      )
    : []
  return description === '' && elected.length === 0
    ? {}
    : {
        displayConfig: {
          ...(description !== '' ? { description } : {}),
          ...(elected.length > 0 ? { entrySummary: { fieldIds: elected } } : {}),
        },
      }
}

const evidenceConfigOf = (
  draft: Draft,
  schemaOf?: (parameter: string) => AtomicSchema | undefined,
) => ({
  entrySource: draft.entrySource,
  formConfig: {
    fields: draft.fields.map((field) => {
      const base = {
        id: field.id.trim() === '' ? field.key.trim() : field.id.trim(),
        key: field.key.trim(),
        type: field.type,
        label: field.label.trim(),
        ...(field.required ? { required: true } : {}),
      }
      switch (field.type) {
        case 'text':
          return {
            ...base,
            ...(field.maxLength.trim() !== '' ? { maxLength: Number(field.maxLength) } : {}),
          }
        case 'date':
          return {
            ...base,
            ...(field.min.trim() !== '' ? { min: field.min.trim() } : {}),
            ...(field.max.trim() !== '' ? { max: field.max.trim() } : {}),
          }
        case 'integer':
          return {
            ...base,
            ...(field.min.trim() !== '' ? { min: Number(field.min) } : {}),
            ...(field.max.trim() !== '' ? { max: Number(field.max) } : {}),
          }
        case 'decimal':
          return {
            ...base,
            maxScale: Number(field.maxScale) >= 0 ? Number(field.maxScale) : 2,
            ...(field.min.trim() !== '' ? { min: field.min.trim() } : {}),
            ...(field.max.trim() !== '' ? { max: field.max.trim() } : {}),
          }
        case 'choice':
          return {
            ...base,
            options: field.options
              .map((option) => ({ value: option.value.trim(), label: option.label.trim() }))
              .filter((option) => option.value !== '' || option.label !== ''),
          }
        case 'attachment':
          return {
            ...base,
            maxCount: Number(field.maxCount) > 0 ? Number(field.maxCount) : 1,
            ...(field.maxSizeMb.trim() !== ''
              ? { maxFileBytes: Number(field.maxSizeMb) * 1024 * 1024 }
              : {}),
            ...(field.accept.trim() !== ''
              ? {
                  accept: field.accept
                    .split(',')
                    .map((kind) => kind.trim())
                    .filter((kind) => kind !== ''),
                }
              : {}),
          }
      }
    }),
  },
  scoringConfig: scoringOf(draft, aggregatorOf(draft), schemaOf),
  ...displayConfigOf(draft, true),
  reviewPolicy: reviewPolicyOf(draft),
})

/**
 * A composition reduced to what a save would actually send.
 *
 * The handles the pen uses to tell one field or one review step from another
 * are its own bookkeeping - they are minted fresh every time a stored
 * question is read back into it, and they never leave the browser. Comparing
 * them would be comparing two readings rather than two questions.
 */
const stated = (draft: Draft): string =>
  JSON.stringify({
    title: draft.title.trim(),
    scoreGroupId: draft.scoreGroupId,
    maxEntries: draft.maxEntries.trim() === '' ? null : Math.max(1, Number(draft.maxEntries)),
    config: configOf(draft),
  })

export function ItemConfigEditor({
  batchId,
  batchStatus,
  materialRange,
  participantCount,
  item,
  groups,
  defaultGroupId,
  options,
  menu,
  trail,
  placement,
  paper,
  held,
  onHold,
  onDirty,
  onCancel,
  onSaved,
}: {
  batchId: string
  batchStatus: string
  /** the round's own window; a date field can only narrow it, never widen it */
  materialRange: { start: string; end: string }
  /** how many people are on the roster, for a question granted to all of them */
  participantCount: number
  /** null while a question is being composed and has never been saved */
  item: ItemDto | null
  groups: readonly { id: string; name: string }[]
  /** the group a new question was opened inside */
  defaultGroupId?: string | undefined
  options: ItemOptions
  /** what else can be done to the question, as the rows of its own menu */
  menu?: React.ReactNode
  /** where this sits in the paper, outermost group first */
  trail: readonly string[]
  /** the limits this question's score has to pass through */
  placement: Placement
  /**
   * Every question of the round, in the order the paper reads them, so this
   * one can say which of them it is. Counted across the whole paper rather
   * than the group: an author reading through what a round asks does not
   * stop at a group boundary.
   */
  paper: readonly { id: string; title: string }[]
  /** what was being composed when this last unmounted, if anything */
  held?: Draft | undefined
  /** every keystroke, so the page can hand the same composition back later */
  onHold?: ((draft: Draft) => void) | undefined
  /** whether the pane holds edits the round has not been told about yet */
  onDirty?: ((dirty: boolean) => void) | undefined
  onCancel: () => void
  onSaved: (itemId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError, formatText, locale } = useI18n()
  const [draft, setDraft] = useState<Draft>(() => {
    if (held !== undefined) return held
    const seeded = draftOf(item, groups, options)
    return defaultGroupId === undefined ? seeded : { ...seeded, scoreGroupId: defaultGroupId }
  })
  // the page keeps what is being composed, so selecting another row and
  // coming back finds the work rather than a blank form
  useEffect(() => {
    onHold?.(draft)
  }, [draft, onHold])

  // What the round would be told if this were saved now, against what it was
  // told last: publishing a question while the pane says something else would
  // ship the older answer under the newer one's name.
  //
  // Compared as what a save would send, not as the pen holding it. The pen
  // mints a fresh handle for every review step each time it reads a question
  // back, so comparing the two pens said "changed" for ever, and every saved
  // question refused to publish because it thought it was unsaved.
  const wasSaid = useMemo(
    () => (item === null ? null : stated(draftOf(item, groups, options))),
    [item, groups, options],
  )
  const dirty = wasSaid !== null && stated(draft) !== wasSaid
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])
  const [problem, setProblem] = useState<string | null>(null)
  const [issues, setIssues] = useState<readonly { path: string; reason: string }[]>([])
  const [openField, setOpenField] = useState<string | null>(null)
  const [openStage, setOpenStage] = useState<string | null>(null)
  const [askingReason, setAskingReason] = useState(false)
  // what a save would disturb, when the server hands it back to be answered.
  // The reason travels with it: the first pass may already have carried one,
  // and answering the question does not make the round stop needing it.
  const [impact, setImpact] = useState<ChangeImpact | null>(null)
  const [draftReason, setDraftReason] = useState<string | null>(null)
  const lingeringImpact = useLingering(impact)

  const patch = (next: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...next }))

  /**
   * Changing what a field asks for is not editing that field.
   *
   * "2026-04-12" is not an answer to a question now asking for text, so a
   * type change mints a new key and a new identity: the old field is gone
   * and a new one stands in its place, and nothing already filed is carried
   * into it. Everything else about a field - its label, its bounds, whether
   * it is required - is an edit of the same question.
   */
  const patchField = (key: string, next: FieldDraft) => {
    const standing = draft.fields.find((one) => one.key === key)
    const retyped = standing !== undefined && next.type !== standing.type
    const minted = retyped ? nextKey() : null
    setDraft((previous) => ({
      ...previous,
      fields: previous.fields.map((field) =>
        field.key === key
          ? { ...next, ...(minted === null ? {} : { id: minted, key: minted }) }
          : field,
      ),
    }))
    if (minted !== null) setOpenField((open) => (open === key ? minted : open))
  }

  const save = useMutation({
    mutationFn: ({ reason, effects }: { reason: string | null; effects?: ChangeEffects }) => {
      const config = configOf(draft, schemaOf)
      // one grant per person: the count is not the administrator's to set on
      // a question nobody files
      const maxEntries =
        draft.itemType === 'constant'
          ? 1
          : draft.maxEntries.trim() === ''
            ? null
            : Math.max(1, Number(draft.maxEntries))
      if (item === null) {
        return run(
          api.assessment.createItem({
            params: { batchId },
            payload: {
              itemType: draft.itemType,
              title: draft.title.trim(),
              scoreGroupId: draft.scoreGroupId,
              maxEntries,
              config: config as never,
            },
          }),
        )
      }
      return run(
        api.assessment.updateItem({
          params: { itemId: item.id },
          payload: {
            title: draft.title.trim(),
            scoreGroupId: draft.scoreGroupId,
            maxEntries,
            config: config as never,
            // which version this edit was composed against: two people with
            // the same question open must not both save over each other
            expectedRevisionId: item.currentRevision?.id ?? null,
            ...(reason === null ? {} : { reason }),
            ...(effects === undefined ? {} : { effects }),
          },
        }),
      )
    },
    onMutate: ({ reason }) => {
      setProblem(null)
      setIssues([])
      setDraftReason(reason)
    },
    onSuccess: (result: { item: { id: string } }) => {
      toast.success(format(m.itemsSaved))
      setAskingReason(false)
      setImpact(null)
      onSaved(result.item.id)
    },
    onError: (error: unknown) => {
      // not a refusal: the save is waiting to be told what should happen to
      // the work it would disturb, and asks in its own dialog
      const asked = error as { _tag?: string } & ChangeImpact
      if (asked?._tag === 'ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED') {
        setAskingReason(false)
        setImpact({ impactToken: asked.impactToken, form: asked.form, review: asked.review })
        return
      }
      const config = error as { issues?: readonly { path: string; reason: string }[] }
      if (Array.isArray(config.issues)) setIssues(config.issues)
      setProblem(formatError(error))
      setAskingReason(false)
      setImpact(null)
    },
  })

  // by key, never by index: a step deleted above must not silently turn the
  // step below it into something else
  const patchStage = (key: string, next: Partial<StageDraft>) =>
    setDraft((previous) => ({
      ...previous,
      stages: previous.stages.map((stage) => (stage.key === key ? { ...stage, ...next } : stage)),
    }))

  const moveStage = (key: string, delta: -1 | 1) =>
    setDraft((previous) => {
      const stage = previous.stages.find((candidate) => candidate.key === key)
      if (stage === undefined) return previous
      const siblings = previous.stages.filter((candidate) => candidate.chain === stage.chain)
      const at = siblings.findIndex((candidate) => candidate.key === key)
      const target = at + delta
      if (target < 0 || target >= siblings.length) return previous
      const reordered = [...siblings]
      const [moved] = reordered.splice(at, 1)
      reordered.splice(target, 0, moved!)
      const others = previous.stages.filter((candidate) => candidate.chain !== stage.chain)
      return {
        ...previous,
        stages: stage.chain === 'normal' ? [...reordered, ...others] : [...others, ...reordered],
      }
    })

  /**
   * A step goes where the author points, not on the end.
   *
   * Adding to the end and expecting people to walk it up with arrows is
   * asking them to do the insertion themselves, one press at a time, in a
   * chain whose order is its whole meaning.
   */
  /**
   * A step goes where the author pointed, not on the end.
   *
   * Adding to the end and expecting people to walk it up with arrows is
   * asking them to do the insertion themselves, one press at a time, in a
   * chain whose order is its whole meaning.
   */
  const addStage = (chain: 'normal' | 'escalation', at?: number) => {
    const stage = blankStage(options, chain)
    setDraft((previous) => {
      const own = previous.stages.filter((one) => one.chain === chain)
      const others = previous.stages.filter((one) => one.chain !== chain)
      const placed = [...own]
      placed.splice(at ?? own.length, 0, stage)
      return {
        ...previous,
        stages: chain === 'normal' ? [...placed, ...others] : [...others, ...placed],
      }
    })
    setOpenStage(stage.key)
  }

  const stageReady = (stage: StageDraft) =>
    stage.label.trim() !== '' &&
    (stage.kind === 'roleAt'
      ? stage.nodeTypeId !== '' && stage.roleIds.length > 0
      : stage.roleId !== '')

  /**
   * Everything standing between this and a save, in the words of the thing
   * that is missing.
   *
   * Collected rather than reduced to a boolean, because a button that is
   * merely dead tells the reader they have done something wrong without ever
   * saying what - and the answer is always known here.
   */
  // What may do the arithmetic, from the manifest rather than a list kept
  // here: a plugin that ships a scoring driver says so in its own
  // descriptor, and this chooser can only ever show what the assembly
  // actually installed for this reader.
  const calculators = useUiCollection(calculatorAuthoringOptions)
  const chosenCalculator =
    draft.scoring.language === 'v2'
      ? draft.scoring.calculator
      : { ref: 'fixed@1', config: { value: draft.fixedValue } }
  const onCalculatorChange = (next: { ref: string; config: unknown }) => {
    // where the change lands depends on the language: the legacy one keeps
    // the amount in the pen's own field, the versioned one holds the whole
    // calculator configuration and remembers that it was edited
    if (draft.scoring.language === 'v2') {
      // a different arithmetic asks for different things: the facts and
      // bindings answered the OLD contract, and carrying them across would
      // leave a configuration that names parameters nobody has
      const rebound = next.ref !== draft.scoring.calculator.ref
      patch({
        scoring: {
          ...draft.scoring,
          calculator: next,
          ...(rebound ? { recognitions: {}, bindings: {} } : {}),
          touched: true,
        },
      })
      return
    }
    if (next.ref === 'fixed@1' && draft.scoring.language === 'v1') {
      patch({ fixedValue: String((next.config as { value?: unknown })?.value ?? '') })
    }
  }

  /**
   * Choosing which arithmetic scores this question.
   *
   * The legacy language stays itself for as long as it keeps its own
   * arithmetic; anything else needs the versioned one, and once a question
   * speaks it, it never goes back - a V2 question scored by a fixed amount
   * is lawful, and downgrading would throw away identities the server
   * refuses to revive.
   */
  const onCalculatorPicked = (ref: string) => {
    if (ref === chosenCalculator.ref) return
    if (draft.scoring.language === 'v1' && ref === 'fixed@1') return
    if (draft.scoring.language === 'v1') {
      patch({
        scoring: {
          language: 'v2',
          original: null,
          calculator: { ref, config: {} },
          recognitions: {},
          bindings: {},
          touched: true,
        },
      })
      return
    }
    onCalculatorChange({ ref, config: {} })
  }

  /**
   * What the chosen arithmetic needs, asked of the server (§9.8).
   *
   * The key IS the candidate: batch, question, form and the whole calculator
   * configuration. React Query never applies an answer to a different key,
   * so a reply to the configuration somebody has already moved on from
   * cannot land on the one in front of them - which matters here because
   * each answer decides what the parameter rows even are.
   *
   * Not on every keystroke: the calculator's own editor commits a
   * configuration, and the form fields are read as they stand when it does.
   */
  const formConfigNow = configOf(draft).formConfig
  const contract = useQuery({
    queryKey: [
      'assessment',
      'scoring-preview',
      batchId,
      item?.id ?? 'new',
      draft.itemType,
      JSON.stringify(formConfigNow),
      chosenCalculator.ref,
      JSON.stringify(chosenCalculator.config),
    ],
    queryFn: () =>
      run(
        api.assessment.previewScoring({
          params: { batchId },
          payload: {
            itemType: draft.itemType,
            formConfig: formConfigNow,
            calculator: chosenCalculator,
            ...(item === null ? {} : { itemId: item.id }),
          },
        }),
      ),
    enabled: draft.scoring.language === 'v2',
  })
  const parameterSchemas = contract.data?.inputSchema as NormalizedInputSchema | undefined
  const schemaOf = (parameter: string): AtomicSchema | undefined =>
    parameterSchemas !== undefined && Object.hasOwn(parameterSchemas.properties, parameter)
      ? (parameterSchemas.properties[parameter] as AtomicSchema)
      : undefined

  const granted = draft.itemType === 'constant'
  const declaredKind = draft.itemType === 'declaration'
  const fielded = draft.itemType === 'evidence'
  const routed = !granted && draft.reviewMode === 'workflow'
  const missing: string[] = [
    draft.title.trim() === '' ? format(m.itemsNeedTitle) : '',
    draft.scoreGroupId === '' ? format(m.itemsNeedGroup) : '',
    draft.scoring.language === 'v1' && draft.fixedValue.trim() === ''
      ? format(m.itemsNeedValue)
      : '',
    fielded && draft.fields.some((field) => field.label.trim() === '')
      ? format(m.itemsNeedFieldLabel)
      : '',
    routed && draft.stages.some((stage) => !stageReady(stage)) ? format(m.itemsNeedStage) : '',
    // a versioned question whose arithmetic was edited cannot be written
    // against a contract this screen does not have: the bindings would be
    // composed against the last one that answered, which is a different
    // question from the one being saved
    draft.scoring.language === 'v2' && draft.scoring.touched && !contract.isSuccess
      ? format(m.itemsContractUnavailable)
      : '',
  ].filter((one) => one !== '')

  // The api asks for a sentence when a live question's scoring or placement
  // moves, and only then. Asking any wider trains people to invent one.
  // like for like: a pristine versioned configuration is carried whole, so
  // it compares equal by construction rather than by luck, and an untouched
  // question no longer demands a sentence explaining a change nobody made
  const scoringMoved =
    item?.currentRevision !== null &&
    item?.currentRevision !== undefined &&
    JSON.stringify(configOf(draft, schemaOf).scoringConfig) !==
      JSON.stringify(item.currentRevision.scoringConfig)
  const placementMoved = item !== null && draft.scoreGroupId !== item.scoreGroupId
  const needsReason =
    item !== null &&
    item.status === 'active' &&
    batchStatus === 'active' &&
    (scoringMoved || placementMoved)

  const stage = draft.stages.find((one) => one.key === openStage) ?? null
  const lingeringStage = useLingering(stage)
  // once asked, it stays mounted so closing it is a close and not a vanish
  const askedOnce = useLingering(askingReason ? true : null) === true

  const at = paper.findIndex((one) => one.id === item?.id)
  // What this question can contribute before any group has its say: the
  // amount times the entries the folding rule beside it counts, which is one
  // under 只计最高 however many the filing limit allows.
  const entries = draft.maxEntries.trim() === '' ? null : Number(draft.maxEntries)
  const each = Number(draft.fixedValue.trim())
  const counted = countedEntries(foldingOf(draft), entries)
  const ceiling =
    counted === null || !Number.isFinite(each)
      ? null
      : amountOf(unitsOf(draft.fixedValue.trim()) * counted)

  return (
    <div {...stylex.props(styles.editorRoot)}>
      {/* The page's own band says which question this is - built to the same
          two lines every section heading has, name over context, so taking
          the band over changes what it says and not where anything sits. */}
      <BatchBanner>
        <PageHeader
          variant="banner"
          title={
            <>
              <span {...stylex.props(styles.truncateMin)}>
                {draft.title.trim() === '' ? format(m.itemsUntitled) : draft.title}
              </span>
              <StandingChip item={item} />
            </>
          }
          description={
            <>
              {/* text-sized rather than a button's own size: a control as tall
                  as a control in a line of prose makes that line taller than
                  the same line in the heading it hands over from */}
              <button
                type="button"
                aria-label={format(m.itemsBack)}
                {...stylex.props(styles.backButton)}
                onClick={onCancel}
              >
                <ArrowLeftIcon aria-hidden className={stylex.props(styles.icon14).className} />
              </button>
              <span {...stylex.props(styles.truncateMin)}>
                {trail.map((name, index) => (
                  <span key={`${index}:${name}`}>
                    {index > 0 && <span {...stylex.props(styles.trailSep)}>&rsaquo;</span>}
                    {name}
                  </span>
                ))}
              </span>
              {at >= 0 && paper.length > 1 && (
                <>
                  <span aria-hidden {...stylex.props(styles.trailDot)}>
                    &middot;
                  </span>
                  <span {...stylex.props(styles.shrinkNone)}>
                    {format(m.itemsPaperPosition, { index: at + 1, total: paper.length })}
                  </span>
                </>
              )}
            </>
          }
          actions={
            <>
              {menu !== undefined && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={format(m.structureRowMenu)}
                      className={stylex.props(styles.menuButton).className}
                    >
                      <EllipsisVerticalIcon aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className={stylex.props(styles.field).className}>
                    {menu}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="outline" onClick={onCancel}>
                {format(commonMessages.cancel)}
              </Button>
              {/* pressable even when it cannot go through: the press is how
                  the reader asks what is wrong, and the answer is right here */}
              <Button
                disabled={save.isPending}
                onClick={() => {
                  if (missing.length > 0) {
                    setProblem(
                      format(m.itemsCannotSave, {
                        reasons: missing.join(format(m.listSeparator)),
                      }),
                    )
                    return
                  }
                  setProblem(null)
                  if (needsReason) setAskingReason(true)
                  else save.mutate({ reason: null })
                }}
              >
                {format(m.entrySave)}
              </Button>
            </>
          }
        />
      </BatchBanner>

      <div {...stylex.props(styles.layout)}>
        <div {...stylex.props(styles.mainColumn)}>
          {(problem !== null || issues.length > 0) && (
            <div {...stylex.props(styles.problemSeat)}>
              <Feedback message={problem} />
              {issues.length > 0 && (
                <ul {...stylex.props(styles.issueList)}>
                  {issues.map((issue, index) => (
                    <li key={index}>
                      {issue.path}: {issue.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Section title={format(m.itemsTabBasics)} hint={format(m.itemsBasicsHint)}>
            <div {...stylex.props(styles.fieldColumn)}>
              {/* The kind decides which of the sections below exist at all,
                  and a dropdown hides that: what a reader needs to see when
                  choosing is the consequence, not the word. Three cards
                  abreast, and the page grows and shrinks under them. */}
              <KindCards
                value={draft.itemType}
                locked={item !== null}
                onChange={(itemType) => patch({ itemType })}
              />
              <Field label={format(m.itemsFieldTitle)}>
                {(id) => (
                  <Input
                    id={id}
                    value={draft.title}
                    placeholder={format(m.itemsTitlePlaceholder)}
                    onChange={(event) => patch({ title: event.target.value })}
                  />
                )}
              </Field>
              <div {...stylex.props(styles.pairGrid)}>
                <Field label={format(m.itemsFieldGroup)}>
                  {(id) => (
                    <Choice
                      id={id}
                      value={draft.scoreGroupId}
                      options={groups.map((group) => ({ value: group.id, label: group.name }))}
                      onChange={(scoreGroupId) => patch({ scoreGroupId })}
                    />
                  )}
                </Field>
                {!granted && (
                  <Field label={format(m.itemsFieldEntrySource)}>
                    {(id) => (
                      <Choice
                        id={id}
                        value={draft.entrySource}
                        options={[
                          { value: 'student', label: format(m.itemsEntrySourceStudent) },
                          {
                            value: 'administrative',
                            label: format(m.itemsEntrySourceAdministrative),
                          },
                        ]}
                        onChange={(next) => patch({ entrySource: next as Draft['entrySource'] })}
                      />
                    )}
                  </Field>
                )}
              </div>
              <Field label={format(m.itemsFieldDescription)}>
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    value={draft.description}
                    onChange={(event) => patch({ description: event.target.value })}
                  />
                )}
              </Field>
            </div>
          </Section>

          {granted && (
            <Section title={format(m.itemsGrantedTitle)} hint={format(m.itemsGrantedHint)}>
              {/* who "everybody" is, as a number: an amount granted to a list
                  nobody can see the size of is an amount nobody can check */}
              <div {...stylex.props(styles.statBand)}>
                <div {...stylex.props(styles.statCell)}>
                  <p {...stylex.props(styles.statLabel)}>{format(m.itemsGrantedRoster)}</p>
                  <p {...stylex.props(styles.statValue)}>
                    {format(m.itemsGrantedRosterCount, { count: participantCount })}
                  </p>
                </div>
                <div aria-hidden {...stylex.props(styles.divider)} />
                <p {...stylex.props(styles.smallProse)}>{format(m.itemsGrantedBody)}</p>
              </div>
            </Section>
          )}
          {declaredKind && (
            <Section title={format(m.itemsTabFields)} hint={format(m.itemsDeclaredHint)}>
              <p {...stylex.props(styles.mutedText)}>{format(m.itemsDeclaredBody)}</p>
            </Section>
          )}
          {fielded && (
            <Section title={format(m.itemsTabFields)} hint={format(m.itemsFieldsHint)}>
              <FieldList
                fields={draft.fields}
                materialRange={materialRange}
                openKey={openField}
                onOpen={setOpenField}
                onChange={patchField}
                onReorder={(orderedKeys) =>
                  setDraft((previous) => ({
                    ...previous,
                    fields: orderedKeys.flatMap((key) => {
                      const found = previous.fields.find((one) => one.key === key)
                      return found === undefined ? [] : [found]
                    }),
                  }))
                }
                onRemove={(key) => {
                  setDraft((previous) => ({
                    ...previous,
                    fields: previous.fields.filter((one) => one.key !== key),
                  }))
                  setOpenField(null)
                }}
                onAdd={() => {
                  const key = nextKey()
                  patch({ fields: [...draft.fields, blankField(key)] })
                  setOpenField(key)
                }}
              />
            </Section>
          )}
          {/* a section of its own, right after the fields it elects from
              and before the scoring: it names claims, which is neither a
              form question nor an amount */}
          {fielded && (
            <Section
              title={format(m.itemsSummaryTitle)}
              hint={format(m.itemsSummaryHint, { most: SUMMARY_FIELDS_MOST })}
            >
              <SummaryPicker
                fields={draft.fields}
                elected={draft.summaryFieldIds}
                onChange={(next) => patch({ summaryFieldIds: next })}
              />
            </Section>
          )}
          <Section title={format(m.itemsTabScoring)} hint={format(m.itemsScoringHint)}>
            <div {...stylex.props(styles.fieldColumn)}>
              {/* the width belongs to the wrapper: a field stretches whatever
                  control it is given to its own width */}
              <div {...stylex.props(styles.scoringRow)}>
                {calculators.length > 1 && (
                  <div {...stylex.props(styles.w208)}>
                    <Field label={format(m.itemsCalculator)}>
                      {(id) => (
                        // Choosing one hands the question a configuration
                        // that calculator accepts - an empty one, which its
                        // own editor below fills in. A question already in
                        // the versioned language stays in it whatever is
                        // chosen: the identities it holds are the server's
                        // to mint and it refuses to revive them.
                        <Select value={chosenCalculator.ref} onValueChange={onCalculatorPicked}>
                          <SelectTrigger id={id} xstyle={styles.fullWidth}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {calculators.map((option) => (
                              <SelectItem key={option.ref} value={option.ref}>
                                {formatText(option.label)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                  </div>
                )}
                {/* whoever owns the chosen arithmetic edits its own
                    configuration here; this editor never reads into it */}
                {draft.scoring.language === 'unsupported' ? (
                  <Feedback message={format(m.itemsScoringUnsupported)} />
                ) : (
                  <UiSlot
                    token={calculatorEditorSlot}
                    context={{
                      batchId,
                      itemId: item?.id ?? null,
                      calculator: chosenCalculator,
                      amountPer: granted ? ('item' as const) : ('entry' as const),
                      disabled: false,
                      onChange: onCalculatorChange,
                    }}
                  />
                )}
                {/* what the chosen arithmetic asks for, and what this
                    question can answer it with */}
                {draft.scoring.language === 'v2' &&
                  (contract.isPending ? (
                    <p {...stylex.props(styles.mutedText)}>{format(m.itemsContractPending)}</p>
                  ) : contract.isError ? (
                    <Feedback message={format(m.itemsContractUnavailable)} />
                  ) : (
                    <ScoringBindingEditor
                      inputSchema={contract.data.inputSchema as NormalizedInputSchema}
                      bindableFields={contract.data.bindableFields}
                      recognitions={draft.scoring.recognitions}
                      bindings={draft.scoring.bindings}
                      disabled={false}
                      locale={locale}
                      onChange={(next) =>
                        patch({
                          scoring: {
                            ...(draft.scoring as Extract<ScoringDraft, { language: 'v2' }>),
                            ...next,
                            touched: true,
                          },
                        })
                      }
                    />
                  ))}
                {/* how several claims fold together, and how many one
                    person may file: both are questions about filing, and a
                    question granted to everybody is never filed */}
                {!granted && (
                  <>
                    <div {...stylex.props(styles.w208)}>
                      <Field label={format(m.itemsFolding)} hint={format(m.itemsFoldingHint)}>
                        {(id) => (
                          <Select
                            value={draft.folding}
                            disabled={draft.scoring.language === 'unsupported'}
                            onValueChange={(next) => patch({ folding: next as Draft['folding'] })}
                          >
                            <SelectTrigger id={id} xstyle={styles.fullWidth}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sum" description={format(m.itemsFoldingSumHint)}>
                                {format(m.itemsFoldingSum)}
                              </SelectItem>
                              <SelectItem value="max" description={format(m.itemsFoldingMaxHint)}>
                                {format(m.itemsFoldingMax)}
                              </SelectItem>
                              <SelectItem
                                value="top-n"
                                description={format(m.itemsFoldingTopNHint)}
                              >
                                {format(m.itemsFoldingTopN)}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </Field>
                    </div>
                    {draft.folding === 'top-n' && (
                      <div {...stylex.props(styles.w112)}>
                        <Field label={format(m.itemsFoldingN)}>
                          {(id) => (
                            <Input
                              id={id}
                              className={stylex.props(styles.tabular).className}
                              value={draft.topN}
                              onChange={(event) => patch({ topN: event.target.value })}
                            />
                          )}
                        </Field>
                      </div>
                    )}
                    <div {...stylex.props(styles.w240)}>
                      <Field label={format(m.itemsFieldMax)}>
                        {(id) => (
                          <div {...stylex.props(styles.inlineRow)}>
                            <Input
                              id={id}
                              type="number"
                              min={1}
                              className={stylex.props(styles.w96, styles.tabular).className}
                              disabled={entries === null}
                              value={draft.maxEntries}
                              onChange={(event) => patch({ maxEntries: event.target.value })}
                            />
                            <label {...stylex.props(styles.anyLabel)}>
                              <Checkbox
                                checked={entries === null}
                                onCheckedChange={(next) =>
                                  patch({ maxEntries: next === true ? '' : '1' })
                                }
                              />
                              {format(m.itemsMaxEntriesAny)}
                            </label>
                          </div>
                        )}
                      </Field>
                    </div>
                  </>
                )}
              </div>
              <ScoringSummary
                granted={granted}
                ceiling={granted ? amountOf(unitsOf(draft.fixedValue.trim())) : ceiling}
                counted={counted}
                folding={foldingOf(draft)}
                each={draft.fixedValue}
                placement={placement}
              />
            </div>
          </Section>

          {/* A recorded question still carries a chain: recording does not
              walk it, but a later challenge resolves the chain from this very
              revision, so a question saved without one would be history with
              no way back. What differs is when it runs, which is what the
              hint has to say. */}
          {!granted && (
            <Section
              title={format(m.itemsTabReview)}
              hint={format(
                draft.entrySource === 'administrative'
                  ? m.itemsChainHintRecorded
                  : m.itemsChainHintNew,
              )}
            >
              <div {...stylex.props(styles.reviewColumn)}>
                {/* "no review" is said, never implied by an empty route */}
                <Choice
                  value={draft.reviewMode}
                  options={[
                    { value: 'workflow', label: format(m.itemsReviewWorkflow) },
                    { value: 'none', label: format(m.itemsReviewNone) },
                  ]}
                  onChange={(next) => patch({ reviewMode: next as Draft['reviewMode'] })}
                />
                {draft.reviewMode === 'none' ? (
                  <p {...stylex.props(styles.mutedText)}>{format(m.itemsReviewNoneHint)}</p>
                ) : (
                  <>
                    <ChainFlow
                      batchId={batchId}
                      chain="normal"
                      steps={draft.stages.filter((one) => one.chain === 'normal')}
                      options={options}
                      onOpen={setOpenStage}
                      onAdd={(at) => addStage('normal', at)}
                      onMove={moveStage}
                      onRemove={(key) =>
                        setDraft((previous) => ({
                          ...previous,
                          stages: previous.stages.filter((one) => one.key !== key),
                        }))
                      }
                    />
                    {draft.stages.some((one) => one.chain === 'escalation') ? (
                      <div {...stylex.props(styles.escalationBlock)}>
                        <div>
                          <h4 {...stylex.props(styles.subheading)}>
                            {format(m.itemsEscalationTitle)}
                          </h4>
                          <p {...stylex.props(styles.subhint)}>{format(m.itemsEscalationHint)}</p>
                        </div>
                        <ChainFlow
                          batchId={batchId}
                          chain="escalation"
                          steps={draft.stages.filter((one) => one.chain === 'escalation')}
                          options={options}
                          onOpen={setOpenStage}
                          onAdd={(at) => addStage('escalation', at)}
                          onMove={moveStage}
                          onRemove={(key) =>
                            setDraft((previous) => ({
                              ...previous,
                              stages: previous.stages.filter((one) => one.key !== key),
                            }))
                          }
                        />
                      </div>
                    ) : (
                      <div {...stylex.props(styles.escalationEmptyRow)}>
                        <InlineAdd
                          label={format(m.itemsEscalationAddStep)}
                          onClick={() => addStage('escalation')}
                        />
                        <span {...stylex.props(styles.quietNote)}>
                          {format(m.itemsEscalationEmpty)}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Section>
          )}
        </div>

        <aside {...stylex.props(styles.aside)}>
          <div {...stylex.props(styles.asidePanel)}>
            <ParticipantPreview draft={draft} />
            <Placed ceiling={ceiling} placement={placement} />
            <Versions item={item} />
          </div>
        </aside>
      </div>

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {lingeringStage !== null && (
        <StageSheet
          open={stage !== null}
          batchId={batchId}
          stage={lingeringStage}
          options={options}
          panelable={
            lingeringStage.chain === 'escalation' &&
            draft.stages
              .filter((one) => one.chain === 'escalation')
              .findIndex((one) => one.key === lingeringStage.key) <
              draft.stages.filter((one) => one.chain === 'escalation').length - 1
          }
          onChange={(next) => patchStage(lingeringStage.key, next)}
          onClose={() => setOpenStage(null)}
        />
      )}

      {askedOnce && (
        <ReasonDialog
          open={askingReason}
          title={format(m.itemsReasonTitle)}
          description={format(m.itemsReasonHint)}
          busy={save.isPending}
          onConfirm={(reason) => save.mutate({ reason })}
          onClose={() => setAskingReason(false)}
        />
      )}

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {lingeringImpact !== null && (
        <ImpactDialog
          open={impact !== null}
          impact={lingeringImpact}
          busy={save.isPending}
          onConfirm={(effects) => save.mutate({ reason: draftReason, effects })}
          onClose={() => setImpact(null)}
        />
      )}
    </div>
  )
}

/**
 * One part of the question: what it decides on the left, the controls that
 * decide it on the right. No box around either - a rule between two parts is
 * enough to separate them, and a screen of rounded boxes inside rounded
 * boxes is what these controls used to disappear into.
 */
/**
 * What kind of question this is, as three cards rather than a list.
 *
 * The kind is not one setting among the others: it decides which of the
 * others exist. A confirmation has no fields, an automatic one has no review
 * route either, and a control that hides that behind a closed dropdown asks
 * an administrator to choose without seeing what they are choosing.
 *
 * Locked once the question exists. What a question is cannot change under
 * the claims already filed against it, and the reason says so rather than
 * leaving three dead cards to be puzzled over.
 */
function KindCards({
  value,
  locked,
  onChange,
}: {
  value: Draft['itemType']
  locked: boolean
  onChange: (next: Draft['itemType']) => void
}) {
  const { format } = useI18n()
  const kinds: readonly [Draft['itemType'], MessageDescriptor, MessageDescriptor][] = [
    ['evidence', m.itemsKindEvidence, m.itemsKindEvidenceHint],
    ['declaration', m.itemsKindDeclaration, m.itemsKindDeclarationHint],
    ['constant', m.itemsKindConstant, m.itemsKindConstantHint],
  ]
  return (
    <div {...stylex.props(styles.kindRoot)}>
      <p {...stylex.props(styles.subheading)}>{format(m.itemsKind)}</p>
      <div {...stylex.props(styles.kindGrid)}>
        {kinds.map(([kind, name, hint]) => {
          const chosen = value === kind
          return (
            <button
              key={kind}
              type="button"
              disabled={locked}
              aria-pressed={chosen}
              onClick={() => onChange(kind)}
              {...stylex.props(
                styles.kindCard,
                chosen ? styles.kindCardChosen : !locked && styles.kindCardRest,
                locked && styles.kindCardLocked,
                locked && chosen && styles.kindCardLockedChosen,
              )}
            >
              <span {...stylex.props(styles.kindHead)}>
                <span
                  aria-hidden
                  {...stylex.props(
                    styles.kindDot,
                    chosen ? styles.kindDotChosen : styles.kindDotRest,
                  )}
                >
                  {chosen && <span {...stylex.props(styles.kindDotFill)} />}
                </span>
                <span {...stylex.props(styles.kindName, chosen && styles.kindNameChosen)}>
                  {format(name)}
                </span>
              </span>
              <span {...stylex.props(styles.kindHint)}>{format(hint)}</span>
            </button>
          )
        })}
      </div>
      {locked && <p {...stylex.props(styles.smallMuted)}>{format(m.itemsKindLocked)}</p>}
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionWords)}>
        <h3 {...stylex.props(styles.sectionTitle)}>{title}</h3>
        <p {...stylex.props(styles.smallProse)}>{hint}</p>
      </div>
      <div {...stylex.props(styles.minWidth0)}>{children}</div>
    </section>
  )
}

/** where the question stands, and which version of it is on screen */
function StandingChip({ item }: { item: ItemDto | null }) {
  const { format } = useI18n()
  if (item === null) {
    return <span {...stylex.props(styles.chip)}>{format(m.itemsNew)}</span>
  }
  return (
    <span {...stylex.props(styles.chip, styles.chipItems)}>
      <span
        aria-hidden
        {...stylex.props(
          styles.statusDot,
          item.status === 'active' ? styles.statusDotActive : styles.statusDotIdle,
        )}
      />
      {item.status === 'voided'
        ? format(m.itemsStatusVoided)
        : format(item.status === 'active' ? m.itemsPublishedVersion : m.itemsDraftVersion, {
            no: item.currentRevision?.revisionNo ?? 1,
          })}
    </span>
  )
}

function InlineAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" {...stylex.props(styles.inlineAdd)} onClick={onClick}>
      <PlusIcon aria-hidden className={stylex.props(styles.icon14).className} />
      {label}
    </button>
  )
}

/** the arithmetic behind the number, so nobody has to reconstruct it */
function ScoringSummary({
  granted,
  ceiling,
  counted,
  folding,
  each,
  placement,
}: {
  /** granted to everybody: one amount per person, never a count of claims */
  granted: boolean
  ceiling: string | null
  /** how many of a person's entries the folding rule counts */
  counted: number | null
  folding: Folding
  each: string
  placement: Placement
}) {
  const { format } = useI18n()
  const chain = placement.sections
    .map((section) =>
      section.cap === null
        ? format(m.itemsCeilingSectionFree, { name: section.name })
        : format(m.itemsCeilingSectionCapped, {
            name: section.name,
            value: trimAmount(section.cap),
          }),
    )
    .join(format(m.listSeparator))
  return (
    <div {...stylex.props(styles.statBand)}>
      <div {...stylex.props(styles.statCell)}>
        <p {...stylex.props(styles.statLabel)}>{format(m.itemsCeiling)}</p>
        <p
          {...stylex.props(styles.statValue)}
          data-testid="item-ceiling"
          data-ceiling={ceiling ?? 'unlimited'}
        >
          {ceiling === null ? format(m.structureUnlimited) : ceiling}
        </p>
      </div>
      <div aria-hidden {...stylex.props(styles.divider)} />
      {/* where the number comes from, said in the sentence rather than in a
          control of its own. It used to be a dropdown with one option that
          could not be changed, sitting under a heading with the same name as
          the section around it. */}
      <p {...stylex.props(styles.smallProse)}>
        {/* the sentence names the rule the number was worked out under:
            "2 × 5 entries" beside a ceiling of 2 reads as a mistake */}
        {granted
          ? format(m.itemsCeilingHowGranted, { value: trimAmount(each.trim()) })
          : folding.rule === 'max'
            ? format(m.itemsCeilingHowMax, { value: trimAmount(each.trim()) })
            : folding.rule === 'top-n'
              ? format(m.itemsCeilingHowTopN, {
                  value: trimAmount(each.trim()),
                  count: counted ?? folding.n,
                })
              : counted === null
                ? format(m.itemsCeilingHowAny)
                : format(m.itemsCeilingHow, { value: trimAmount(each.trim()), count: counted })}
        {` ${format(m.itemsCeilingSource, { name: format(m.itemsScoringMethodFixed) })}`}
        {chain !== '' && ` ${format(m.itemsCeilingNote, { chain })}`}
      </p>
    </div>
  )
}

/**
 * The path a submission takes, drawn as one line from where it enters to
 * where it leaves. Both routes get both ends: an escalation route that starts and
 * finishes nowhere is a row of boxes, not a route.
 *
 * Markers on their own track, labels under them. Drawn as a row of columns
 * instead, the line between two of them runs from the end of one column to
 * the start of the next - which is nowhere near either marker, and leaves a
 * long blank wherever a label was short. Here each line starts at the marker
 * it leaves and ends at the marker it reaches.
 *
 * Every line is also where another step can go, which is one place per gap:
 * before the first, between any two, after the last.
 */
function ChainFlow({
  batchId,
  chain,
  steps,
  options,
  onOpen,
  onAdd,
  onMove,
  onRemove,
}: {
  batchId: string
  chain: 'normal' | 'escalation'
  steps: readonly StageDraft[]
  options: ItemOptions
  onOpen: (key: string) => void
  /** put one more here: 0 before the first step, steps.length after the last */
  onAdd: (at: number) => void
  /** swap with the neighbour on that side; order is the chain's whole meaning */
  onMove: (key: string, delta: -1 | 1) => void
  onRemove: (key: string) => void
}) {
  const { format } = useI18n()
  const nodes = [
    {
      key: 'start',
      mark: (
        <Marker>
          <span aria-hidden {...stylex.props(styles.startDot)} />
        </Marker>
      ),
      label: (
        <NodeLabel
          title={format(chain === 'normal' ? m.itemsFlowSubmit : m.itemsEscalated)}
          sub={format(chain === 'normal' ? m.itemsFlowSubmitBy : m.itemsEscalationBy)}
        />
      ),
    },
    ...steps.map((one, index) => ({
      key: one.key,
      mark: <StageMarker stage={one} options={options} index={index} />,
      label: (
        <StageLabel
          batchId={batchId}
          stage={one}
          options={options}
          removable={chain === 'escalation' || steps.length > 1}
          atStart={index === 0}
          atEnd={index === steps.length - 1}
          onOpen={() => onOpen(one.key)}
          onMove={(delta) => onMove(one.key, delta)}
          onRemove={() => onRemove(one.key)}
        />
      ),
    })),
    {
      key: 'end',
      mark: (
        <Marker>
          <CheckIcon aria-hidden className={stylex.props(styles.icon12).className} />
        </Marker>
      ),
      label: (
        <NodeLabel
          title={format(chain === 'normal' ? m.itemsFlowDone : m.itemsEscalationSettled)}
          sub={format(chain === 'normal' ? m.itemsFlowDoneSub : m.itemsEscalationSettledSub)}
        />
      ),
    },
  ]

  return (
    <div {...stylex.props(styles.chainScroll)}>
      <div
        {...stylex.props(styles.chainGrid)}
        style={{ gridTemplateColumns: `repeat(${nodes.length}, 11rem)` }}
      >
        {nodes.map((node, index) => (
          <div key={`mark:${node.key}`} {...stylex.props(styles.markRow)}>
            {node.mark}
            {index < nodes.length - 1 && (
              <Gap label={format(m.itemsStageAdd)} onAdd={() => onAdd(index)} />
            )}
          </div>
        ))}
        {nodes.map((node) => (
          <div key={`label:${node.key}`} {...stylex.props(styles.labelCell)}>
            {node.label}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The line from one marker to the next, and the place to put one more step.
 *
 * The button only shows itself when the line is pointed at, so a chain at
 * rest reads as a line rather than as a row of plus signs.
 */
function Gap({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <span {...stylex.props(styles.gapSeat)}>
      <span aria-hidden {...stylex.props(styles.gapLine)} />
      {/* Always on show, and visibly not a step: a step marker is a solid
          24px circle with a number, this is a smaller dashed one with a
          plus. Revealed-on-hover was tried and failed the only person it
          was hidden from - somebody who does not yet know where steps come
          from cannot know where to hover. */}
      <button
        type="button"
        aria-label={label}
        title={label}
        {...stylex.props(styles.gapAdd)}
        onClick={onAdd}
      >
        <PlusIcon aria-hidden className={stylex.props(styles.icon12).className} />
      </button>
    </span>
  )
}

/** where a submission enters the path, and where it leaves it */
function Marker({ children }: { children: React.ReactNode }) {
  return <span {...stylex.props(styles.marker)}>{children}</span>
}

function NodeLabel({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <p {...stylex.props(styles.subheading)}>{title}</p>
      <p {...stylex.props(styles.smallMuted)}>{sub}</p>
    </>
  )
}

/** a step's own marker: its place in the order, or that it is unfinished */
function StageMarker({
  stage,
  options,
  index,
}: {
  stage: StageDraft
  options: ItemOptions
  index: number
}) {
  return (
    <span
      {...stylex.props(
        styles.stageMark,
        completeStage(stage, options) ? styles.stageMarkDone : styles.stageMarkUnset,
      )}
    >
      {index + 1}
    </span>
  )
}

function StageLabel({
  batchId,
  stage,
  options,
  removable,
  atStart,
  atEnd,
  onOpen,
  onMove,
  onRemove,
}: {
  batchId: string
  stage: StageDraft
  options: ItemOptions
  removable: boolean
  atStart: boolean
  atEnd: boolean
  onOpen: () => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const { format } = useI18n()
  const settled = settledStage(stage, options)
  const named = stage.label.trim() !== ''
  return (
    <div
      {...stylex.props(styles.stepRoot)}
      data-testid="chain-step"
      data-step-complete={named && settled}
    >
      {/* The step answers to the name its author gave it and to nothing
          else: the name is required, so an unnamed step says so in red
          rather than dressing itself in the unit-and-roles composite and
          looking finished. */}
      <button
        type="button"
        {...stylex.props(styles.stepName, (!named || !settled) && styles.stepNameBad)}
        onClick={onOpen}
      >
        {named ? stage.label.trim() : format(m.itemsStageUnnamed)}
      </button>
      {/* who actually reviews stays said, in small print, once it is known */}
      {settled && <p {...stylex.props(styles.stepWho)}>{whoReviews(stage, options, format)}</p>}
      {settled ? (
        <StageCoverage batchId={batchId} stage={stage} />
      ) : (
        <p {...stylex.props(styles.smallMuted)}>{format(m.itemsStageUnsetHint)}</p>
      )}
      {/* The step's handling, always on show: order and removal are how the
          chain is composed, and controls that only exist under a hover are
          controls a newcomer never finds. The one unremovable step keeps
          its key, standing but disabled, and the key itself says why. */}
      <span {...stylex.props(styles.stepControls)}>
        <Button
          variant="ghost"
          size="icon-xs"
          className={stylex.props(styles.mutedControl).className}
          disabled={atStart}
          onClick={() => onMove(-1)}
          aria-label={format(m.itemsStageMoveEarlier)}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={stylex.props(styles.mutedControl).className}
          disabled={atEnd}
          onClick={() => onMove(1)}
          aria-label={format(m.itemsStageMoveLater)}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
        {removable ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className={stylex.props(styles.mutedControl).className}
            onClick={onRemove}
            aria-label={format(m.itemsStageRemove)}
          >
            <XIcon aria-hidden />
          </Button>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* a span, because a disabled key ignores the pointer and
                    could not answer the hover that asks about it */}
                <span {...stylex.props(styles.inlineFlex)}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={stylex.props(styles.mutedControl).className}
                    disabled
                    aria-label={format(m.itemsStageRemove)}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{format(m.itemsStageKeepOne)}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
    </div>
  )
}

/** finished enough to stand in the chain: named, and its reviewers chosen */
const completeStage = (stage: StageDraft, options: ItemOptions): boolean =>
  stage.label.trim() !== '' && settledStage(stage, options)

/**
 * A step nobody has finished naming cannot say who reviews at it, and a dash
 * in that space reads as a word rather than as an absence.
 */
const settledStage = (stage: StageDraft, options: ItemOptions): boolean => {
  const where = stage.kind === 'roleAt' ? stage.nodeTypeId !== '' : true
  const who =
    stage.kind === 'roleAt'
      ? options.roles.some((role) => stage.roleIds.includes(role.id))
      : options.roles.some((role) => role.id === stage.roleId)
  return where && who
}

const whoReviews = (
  stage: StageDraft,
  options: ItemOptions,
  format: (message: MessageDescriptor) => string,
): string => {
  const where =
    stage.kind === 'roleAt'
      ? (options.orgTypes.find((one) => one.id === stage.nodeTypeId)?.name ?? '')
      : format(m.itemsStageWalkUp)
  const who =
    stage.kind === 'roleAt'
      ? options.roles
          .filter((role) => stage.roleIds.includes(role.id))
          .map((role) => role.name)
          .join(format(m.listSeparator))
      : (options.roles.find((role) => role.id === stage.roleId)?.name ?? '')
  return `${where} / ${who}`
}

/**
 * Whether anybody can actually act at this step. A chain whose second step
 * has no reviewer in two of twelve units strands whoever files there, and
 * nothing in the step's own settings would say so.
 */
function StageCoverage({ batchId, stage }: { batchId: string; stage: StageDraft }) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const roleIds = stage.kind === 'roleAt' ? stage.roleIds : [stage.roleId]
  const coverage = useQuery({
    ...query.assessment.reviewCoverage.queryOptions({
      params: { batchId },
      query: { nodeTypeId: stage.nodeTypeId, roleIds },
    }),
    // only the level-anchored kind surveys units; the nearest-holder kind is
    // answered per participant, where its answer actually lives
    enabled: stage.kind === 'roleAt' && stage.nodeTypeId !== '' && roleIds.length > 0,
  })
  if (coverage.data === undefined) return null
  const uncovered = coverage.data.nodes.filter((node) => node.reviewers === 0)
  return (
    <p
      {...stylex.props(
        styles.coverageNote,
        uncovered.length > 0 ? styles.coverageBad : styles.coverageOk,
      )}
    >
      {coverage.data.nodes.length === 0
        ? format(m.itemsReviewNoUnits)
        : uncovered.length === 0
          ? format(m.itemsReviewCovered, { count: coverage.data.nodes.length })
          : // named in the step's own panel, where there is room for a list;
            // here the count is what fits and what the reader acts on
            format(m.itemsReviewUncoveredCount, { count: uncovered.length })}
    </p>
  )
}

/**
 * The filing screen this draft produces, drawn from the draft alone. It
 * answers "what will they see" without saving anything.
 */
function ParticipantPreview({ draft }: { draft: Draft }) {
  const { format } = useI18n()
  return (
    <>
      <p {...stylex.props(styles.previewTitle)}>{format(m.itemsPreviewTitle)}</p>
      <div {...stylex.props(styles.previewCard)}>
        <h4 {...stylex.props(styles.sectionTitle)}>
          {draft.title.trim() === '' ? format(m.itemsUntitled) : draft.title}
        </h4>
        <p {...stylex.props(styles.smallProse)}>
          {draft.description.trim() === '' ? '' : `${draft.description.trim()} `}
          {draft.itemType === 'constant' ? (
            format(m.itemsCeilingHowGranted, { value: trimAmount(draft.fixedValue.trim()) })
          ) : (
            <>
              {draft.maxEntries.trim() === ''
                ? format(m.itemsPreviewNoMax)
                : format(m.itemsPreviewMax, { count: Number(draft.maxEntries) })}
              {format(m.listSeparator)}
              {format(m.itemsPreviewValue, { value: trimAmount(draft.fixedValue.trim()) })}
            </>
          )}
        </p>
        {draft.itemType === 'constant' ? (
          <p {...stylex.props(styles.smallMuted)}>{format(m.itemsGrantedBody)}</p>
        ) : draft.itemType === 'declaration' ? (
          <span {...stylex.props(styles.declarePill)}>{format(m.entryDeclare)}</span>
        ) : (
          <div {...stylex.props(styles.previewFields)}>
            {draft.fields.map((field) => (
              <div key={field.key} {...stylex.props(styles.previewField)}>
                <p {...stylex.props(styles.smallMuted)}>
                  {field.label.trim() === '' ? '—' : field.label}
                  {field.required && <span {...stylex.props(styles.requiredStar)}>*</span>}
                </p>
                {field.type === 'attachment' ? (
                  <div {...stylex.props(styles.uploadBox)}>
                    {format(m.itemsPreviewUpload, { count: Number(field.maxCount) || 1 })}
                  </div>
                ) : (
                  <div {...stylex.props(styles.inputBox)} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/** every ceiling this question's score has to pass through, innermost first */
function Placed({ ceiling, placement }: { ceiling: string | null; placement: Placement }) {
  const { format } = useI18n()
  const innermost = placement.sections[0]
  return (
    <div {...stylex.props(styles.placedBlock)}>
      <p {...stylex.props(styles.asideTitle)}>{format(m.itemsPlacementTitle)}</p>
      <Amount
        label={format(m.itemsCeiling)}
        value={ceiling === null ? format(m.structureUnlimited) : ceiling}
      />
      {innermost !== undefined && placement.subtotal !== null && (
        <Amount
          label={format(m.itemsPlacementSubtotal, { name: innermost.name })}
          value={trimAmount(placement.subtotal)}
        />
      )}
      {placement.sections.map((section) =>
        section.cap === null ? null : (
          <Amount
            key={section.id}
            label={format(m.itemsPlacementCap, { name: section.name })}
            value={trimAmount(section.cap)}
          />
        ),
      )}
      <Amount
        label={format(m.itemsPlacementPaper)}
        value={placement.total === null ? format(m.structureUncapped) : trimAmount(placement.total)}
      />
    </div>
  )
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div {...stylex.props(styles.amountRow)}>
      <span {...stylex.props(styles.amountLabel)}>{label}</span>
      <span {...stylex.props(styles.amountValue)}>{value}</span>
    </div>
  )
}

/** what saving does to entries already filed, said before it is pressed */
function Versions({ item }: { item: ItemDto | null }) {
  const { format } = useI18n()
  const revision = item?.currentRevision ?? null
  return (
    <div {...stylex.props(styles.versionsBlock)}>
      <p {...stylex.props(styles.asideTitle)}>{format(m.itemsVersionTitle)}</p>
      <p {...stylex.props(styles.smallProse)}>
        {revision === null
          ? format(m.itemsVersionNew)
          : format(m.itemsVersionNote, {
              no: revision.revisionNo,
              date: revision.createdAt.slice(0, 10),
            })}
      </p>
    </div>
  )
}
