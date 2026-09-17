import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  PageLink,
  useApi,
  useApiQuery,
  useClaimScreenFill,
  usePageHref,
  usePageNavigate,
  usePageQueryState,
  usePageRouteParams,
  usePageTitle,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { layout } from '@qualy/ui/theme/layout.stylex'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { ConfirmDialog, Field } from '@qualy/ui/admin'
import { Spinner } from '@qualy/ui/spinner'
import { Skeleton } from '@qualy/ui/skeleton'
import { EmptyRow } from '@qualy/ui/empty-row'
import { PageContainer } from '@qualy/ui/page-container'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { downloadText, fileNameOf } from '@qualy/ui/download'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@qualy/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@qualy/ui/tooltip'
import {
  CheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  FileCodeIcon,
  HistoryIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  SigmaIcon,
  TagIcon,
  UploadIcon,
} from 'lucide-react'
import type { AtomicSchema } from '@qualy/value-schema'
import { validateValue } from '@qualy/value-schema/validate'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { isBlankSource, useDraftPreview, type DraftContract } from './use-draft-preview.ts'
import { ContractTable } from './ContractTable.tsx'
import { ExampleRow, type Verdict } from './ExampleRow.tsx'
import { exampleStyles } from './example-grid.ts'
import { constraintNote } from './constraint-words.ts'
import {
  contractReasonWords,
  fieldIssueWords,
  inputFactsOf,
  inputIssueWords,
  outcomeWords,
} from './report-words.ts'
import { VersionsDrawer, type HistoryList } from './VersionsDrawer.tsx'
import { VersionSharingDialog } from './VersionSharingDialog.tsx'
import { PublishDialog, type PublishCheck } from './PublishDialog.tsx'
import { ReleaseView } from './ReleaseView.tsx'
import { RevisionView } from './RevisionView.tsx'
import {
  ToneDot,
  WorkbenchBar,
  WorkbenchLayout,
  type Tone,
  type WorkbenchGate,
} from './WorkbenchLayout.tsx'
import { TryRunPanel } from './TryRunPanel.tsx'
import { TryRecordsDrawer } from './TryRecordsDrawer.tsx'
import { sourceMark, useTryRecords, type TryRecord } from './try-records.ts'
import { NewExampleDialog } from './NewExampleDialog.tsx'
import { LazyFormulaCodeEditor } from './lazy-editors.ts'
import { holdEditorLease } from './editor-lease.ts'
import { forgetLocalDraft, keepLocalDraft, readLocalDraft, type LocalDraft } from './local-draft.ts'
import { shortWhen } from './library-styles.ts'
import { workbenchStyles as w } from './workbench-styles.ts'
import { parseView, viewValue, type WorkbenchView } from './workbench-view.ts'
import { MINIMAL_EXAMPLE } from './starter-source.ts'
import { AtomicValueField, InputValueForm } from '@qualy/web-value-form/InputValueForm'
import {
  draftsFromStored,
  materializeField,
  materializeInput,
  type FieldDraft,
} from '@qualy/web-value-form/model'

// One formula, laid out like the tool it is.
//
// A formula has one draft that is edited, a revision left behind by every save
// that changed its source or examples, and publications frozen under the names
// their author gave them. This page is the draft: write on the left, try on
// the right, and under both what stands between it and a publication - its
// examples, what the compiler made of it, the structure it takes. Its history
// sits beside the try-run, and opening a piece of it shows that state
// read-only in the same frame, with the way back to the draft always one
// press away. The draft's unsaved edits live here, so they outlive a look at
// the history.

/** the view the panel under the editor shows */
type PanelTab = 'examples' | 'compile' | 'contract'

/** where a restore reads the state it puts back */
type RestoreFrom =
  | { readonly kind: 'published-version'; readonly versionNo: number }
  | { readonly kind: 'draft-revision'; readonly revisionNo: number }

const styles = stylex.create({
  frame: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  // the name edits in place, as a title rather than as a form field: it is
  // a field only to the pointer resting on it and the caret inside it
  name: {
    minWidth: { default: '6em', [breakpoints.phone]: 0 },
    flexShrink: 1,
    maxWidth: { default: '24rem', [breakpoints.phone]: '100%' },
    height: { default: 28, [breakpoints.phone]: 30 },
    marginLeft: -7,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: 6,
    outline: 'none',
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: { default: 15, [breakpoints.phone]: 17 },
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: tokens.foreground,
    textOverflow: 'ellipsis',
    boxShadow: {
      default: null,
      ':hover': `inset 0 0 0 1px ${tokens.border}`,
      ':focus-visible': `0 0 0 2px color-mix(in oklab, ${tokens.focusRing} 60%, transparent)`,
      ':disabled': 'none',
    },
  },
  statusDirty: { color: tokens.warningForeground },
  // the name is editable, and the pencil after it says so before a pointer
  // finds out; a name typed over but not saved is underlined like any other
  // unsaved change on the page
  nameEdit: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'text',
  },
  nameEditDirty: { color: tokens.warningForeground },
  nameGlyph: { flexShrink: 0 },
  nameDirty: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: tokens.warning,
    textUnderlineOffset: 4,
  },
  statusLabel: { flexShrink: 0 },
  statusGroup: { display: 'inline-flex', minWidth: 0, alignItems: 'center', gap: 4 },
  statusAhead: { color: tokens.warningForeground },
  statusLink: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    color: { default: 'inherit', ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  // a rule between groups on one line; a phone wraps them, where a rule would hang at a line's end
  statusRule: {
    display: { default: 'inline-block', [breakpoints.phone]: 'none' },
    width: 1,
    height: 10,
    flexShrink: 0,
    backgroundColor: tokens.border,
  },
  chip: {
    display: 'inline-flex',
    minWidth: 0,
    maxWidth: '16rem',
    alignItems: 'center',
    gap: 4,
    height: 20,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: 5,
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.border },
    fontFamily: 'inherit',
    fontSize: 11.5,
    color: tokens.surfaceMutedForeground,
    cursor: 'pointer',
  },
  chipStill: { backgroundColor: tokens.surfaceMuted, cursor: 'default' },
  chipWords: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chipQuiet: { color: tokens.mutedForeground },
  tipHost: { display: 'inline-flex' },
  tipHostWide: { display: 'flex', width: '100%' },
  wide: { width: '100%' },
  // a name somebody else chose can be long; the line keeps to one row of it
  statusClip: {
    minWidth: 0,
    maxWidth: '24rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sideNote: {
    minWidth: 0,
    fontSize: 11,
    textAlign: 'right',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  sideNoteOff: { color: tokens.warningForeground },
  notice: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    paddingBlock: 8,
    paddingInline: { default: 20, [breakpoints.phone]: layout.pageGutter },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 13,
  },
  // An offer that must be seen and answered, but never at the cost of moving
  // the code under the caret: it floats at the foot of the source, over it.
  floating: {
    position: 'absolute',
    right: { default: 16, [breakpoints.phone]: 12 },
    bottom: { default: 16, [breakpoints.phone]: 12 },
    left: { default: 'auto', [breakpoints.phone]: 12 },
    zIndex: 4,
    display: 'flex',
    maxWidth: { default: '22rem', [breakpoints.phone]: 'none' },
    flexDirection: 'column',
    gap: 8,
    padding: 12,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.divider}, ${tokens.elevation2}`,
    fontSize: 12.5,
  },
  floatingWords: { display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.5 },
  floatingActions: { display: 'flex', alignItems: 'center', gap: 6 },
  noticeDanger: { backgroundColor: tokens.dangerSurface, color: tokens.danger },
  noticeWarning: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 12%, ${tokens.surface})`,
    color: tokens.foreground,
  },
  noticeWords: { minWidth: 0 },
  noticeTitle: { fontWeight: 600, marginRight: 8 },
  editorLoading: {
    display: 'flex',
    flexGrow: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  // A formula nobody has written a line of: the choice of how to begin takes
  // the room the editor would have, so nothing is typed into a page that has
  // not been started
  emptyFill: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  emptyCard: {
    display: 'flex',
    maxWidth: 360,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    paddingBlock: 22,
    paddingInline: 24,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    textAlign: 'center',
  },
  emptyGlyph: { color: tokens.mutedForeground },
  emptyTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  emptyHint: { margin: 0, fontSize: 13, lineHeight: 1.6, color: tokens.mutedForeground },
  emptyActions: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  tryForm: { paddingInline: 16, paddingBottom: 12 },
  tryPending: {
    display: 'flex',
    minHeight: 150,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginInline: 16,
    marginBottom: 14,
    paddingInline: 16,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: 'center',
    color: tokens.mutedForeground,
  },
  tryPendingOff: { color: tokens.warningForeground },
  tryPendingSpinner: { width: 18, height: 18 },
  tryActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
    paddingBottom: 8,
  },
  tryInline: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 6,
    fontSize: 13,
  },
  tryInlineLabel: { flexShrink: 0, color: tokens.mutedForeground },
  tryInlineValue: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  tryNote: {
    margin: 0,
    paddingInline: 16,
    paddingBottom: 8,
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
  },
  // What a try can become, as one quiet line under the run: two ways to keep
  // it, side by side rather than wrapped under a button that ran out of room.
  trySaves: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 10,
    paddingRight: 16,
    paddingBottom: 12,
  },
  tryLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: {
      default: tokens.surfaceMutedForeground,
      ':hover': tokens.foreground,
      ':disabled': tokens.mutedForeground,
    },
    cursor: { default: 'pointer', ':disabled': 'default' },
  },
  // the one step a standing line offers: words, not a button competing with
  // the two decisions beside it
  quietAction: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    color: { default: tokens.surfaceMutedForeground, ':hover': tokens.foreground },
    textDecoration: { default: 'none', ':hover': 'underline' },
    cursor: 'pointer',
  },
  actionCount: {
    display: 'inline-flex',
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: 5,
    borderRadius: '9999px',
    backgroundColor: tokens.surfaceMuted,
    fontSize: 11,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.surfaceMutedForeground,
  },
  // a quiet strip over a phone's list or code: what it holds, and one way on
  phoneStrip: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingBlock: 6,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  diagnosticRow: {
    cursor: 'pointer',
    backgroundColor: { default: null, ':hover': tokens.surfaceInset },
  },
  middle: { verticalAlign: 'middle' },
  monoAction: {
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 11.5,
    fontWeight: 400,
  },
  iconAction: {
    display: 'inline-flex',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 6,
    padding: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  // the words a packager raised, kept for whoever needs them, on one line
  rawLine: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    margin: 0,
    paddingInline: 16,
    paddingBottom: 10,
  },
  rawWords: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    // the font stack is spelled here: stylex.create cannot read a constant
    // another module exported
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 11.5,
    color: tokens.mutedForeground,
  },
  stripBad: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontWeight: 500,
    color: tokens.danger,
  },
  stateLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: 0,
    paddingBlock: 12,
    paddingInline: 16,
    fontSize: 13,
  },
  issues: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  failTitle: { fontWeight: 500, color: tokens.danger },
  lineGood: { flexShrink: 0, color: tokens.success },
  lineBad: { flexShrink: 0, color: tokens.danger },
  failCount: { fontSize: 12, color: tokens.mutedForeground },
  lineSpinner: { width: 12, height: 12 },
  caseSheet: { width: { default: 420, [breakpoints.phone]: null } },
  caseBody: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
    paddingInline: 24,
    paddingBottom: 16,
  },
  // the three parts of a case, each under its own heading on its own ground
  casePart: { display: 'flex', flexDirection: 'column', gap: 6 },
  casePartTitle: {
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: tokens.mutedForeground,
  },
  casePartBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 12,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
  },
  caseVerdict: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: 0,
    paddingBlock: 10,
    paddingInline: 12,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    fontSize: 13,
  },
  caseVerdictGood: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 12%, ${tokens.surface})`,
    color: tokens.successForeground,
  },
  caseVerdictBad: {
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 10%, ${tokens.surface})`,
    color: tokens.danger,
  },
  caseVerdictWords: { minWidth: 0, overflowWrap: 'anywhere' },
  caseFoot: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 },
  problemLine: { margin: 0, fontSize: 12, color: tokens.danger },
  skeleton: { display: 'flex', flexDirection: 'column', gap: 16, padding: 20 },
  // a phone's source tab: the editor, under a strip that says what stands against it
  phoneSource: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  phoneEditor: {
    position: 'relative',
    display: 'flex',
    minHeight: '18rem',
    flexGrow: 1,
    flexDirection: 'column',
  },
  phoneExamples: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
})

interface DraftTest {
  /** client-local identity: react keys, drafts, results and clientIds all
   * ride this, so copying or deleting a row can never shift state onto a
   * neighbour. Not persisted (yet) - reloading reseeds fresh keys. */
  key: string
  name: string
  inputText: string
  expected: string
}

const newTestKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** the wire/compare projection: identity is local, never sent or compared */
const bareTests = (tests: readonly DraftTest[]) => tests.map(({ key: _key, ...rest }) => rest)

/**
 * How wide the name field is drawn: as wide as the name, so the badge
 * after it sits where the name ends. A Han character is about an em, a
 * Latin one a little over half.
 */
const nameWidth = (name: string): string => {
  const ems = [...name].reduce(
    (sum, character) => sum + (character.charCodeAt(0) > 0x2e80 ? 1 : 0.6),
    0,
  )
  return `calc(${ems.toFixed(1)}em + 14px)`
}

/** JSON with object keys in a fixed order, so equal values compare equal */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, held: unknown) =>
    held !== null && typeof held === 'object' && !Array.isArray(held)
      ? Object.fromEntries(
          Object.keys(held)
            .sort()
            .map((key) => [key, (held as Record<string, unknown>)[key]]),
        )
      : held,
  )

/** a refusal raised by this screen's own checks, worded here, never generic */
class LocalFinding extends Error {}

interface PublishFindings {
  readonly diagnostics?: readonly {
    line: number
    column: number
    code: string
    message: string
  }[]
  readonly report?: readonly {
    name: string
    passed: boolean
    expected: string
    actual?: string
    problems?: readonly {
      at: 'input' | 'expected' | 'output'
      parameter?: string
      reason: string
      constraint?: string
    }[]
    refusal?: string
    defect?: string
  }[]
  readonly issues?: readonly { path: string; reason: string }[]
  /** the guest's own words when contract extraction itself threw */
  readonly detail?: string
  /** the packager's own words when bundling failed */
  readonly packager?: string
}

/** which refusal an error is, when it is one of the api's */
const tagOf = (error: unknown): string | undefined => {
  const tag = (error as { _tag?: unknown } | null | undefined)?._tag
  return typeof tag === 'string' ? tag : undefined
}

/** the structured data a refused publish carries, whichever refusal it was */
const findingsOf = (error: unknown): PublishFindings => {
  const carried = (error ?? {}) as PublishFindings
  return {
    ...(carried.diagnostics === undefined ? {} : { diagnostics: carried.diagnostics }),
    ...(carried.report === undefined ? {} : { report: carried.report }),
    ...(carried.issues === undefined ? {} : { issues: carried.issues }),
    ...(carried.detail === undefined ? {} : { detail: carried.detail }),
    // every error has a message; only the packager's refusal carries one worth showing
    ...(tagOf(error) === 'ASSESSMENT_FORMULA_BUNDLE_FAILED' &&
    typeof (error as { message?: unknown }).message === 'string'
      ? { packager: (error as { message: string }).message }
      : {}),
  }
}

/**
 * The parameter a refusal is about, out of the path the validator names.
 *
 * `properties.hours.x-qualy-maxScale` is about `hours`; `.x-qualy-maxScale`
 * is about the whole declaration and names nobody. The rest of the path is
 * the rule, which the words beside it already say.
 */
const parameterOf = (path: string): string | null => {
  const found = /(?:^|\.)properties\.([^.]+)/.exec(path)
  return found?.[1] ?? null
}

/**
 * The word to look for in the source when a refusal is pressed.
 *
 * A parameter's own name where the path names one; otherwise the setting it
 * is about - `.x-qualy-maximum` is written `maximum:` in the declaration, and
 * that is where its author will start reading.
 */
const sourceWordOf = (path: string): string | null => {
  const named = parameterOf(path)
  if (named !== null) return named
  const last = path
    .split('.')
    .filter((part) => part !== '')
    .at(-1)
  if (last === undefined) return null
  return last.replace(/^x-qualy-/, '')
}

/** the session key the page's own editor draws under; the diagnostics jump into it */
const draftSessionKey = (lease: string) => `${lease}/draft`

/** a hint on hover and focus, which a disabled control cannot carry itself */
function Hinted({
  hint,
  wide = false,
  children,
}: {
  readonly hint: string | null
  readonly wide?: boolean
  readonly children: ReactNode
}) {
  if (hint === null) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} {...stylex.props(wide ? styles.tipHostWide : styles.tipHost)}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

export default function FormulaEditorPage() {
  const { functionId } = usePageRouteParams('functionId')
  const api = useApi(formulaApi)
  const run = useRunApi()
  const query = useApiQuery(formulaApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()

  const detail = useQuery(
    query.assessmentFormula.getFormulaFunction.queryOptions({ params: { functionId } }),
  )
  const fn = detail.data?.function
  const latestNo = fn?.latestVersionNo ?? null
  const latestRelease = useQuery({
    ...query.assessmentFormula.getFormulaVersion.queryOptions({
      params: { functionId, versionNo: String(latestNo ?? 0) },
    }),
    enabled: latestNo !== null,
  })
  // the tries this browser remembers for the draft
  const tryRecords = useTryRecords(`${functionId}/draft`)
  const versions = detail.data?.versions ?? []
  // Where this draft was started from, when it was started from somebody
  // else's. A note about how it came to exist and nothing more: there is
  // no following the source, and no version of it to be behind.
  const copiedFrom = detail.data?.copiedFrom ?? null
  // the shell repeats the formula's name once the bar has scrolled away
  const titleRef = usePageTitle(fn?.name ?? format(m.listTitle))
  // where somebody else's formula can be started from, when this viewer may go there
  const templatesHref = usePageHref('assessment-formula/templates')
  const goto = usePageNavigate()
  // A workbench at every width: it takes the room under the application's
  // bars and scrolls inside. Side by side where there is room, and on a
  // phone the same parts spread over tabs, with the step that comes next
  // standing at the foot.
  const narrow = useIsMobile()
  useClaimScreenFill(true)
  // the editors' buffers, undo histories and language sessions live as long
  // as this page does, not as long as whatever currently draws them
  const [editorLease] = useState(() => `formula-page-${newTestKey()}`)
  useEffect(() => holdEditorLease(editorLease), [editorLease])
  // what waits behind a drawer: the formula's versions, and the tries this
  // browser remembers
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)
  // whose audience is open for changing; kept while the dialog closes, so
  // its words stay put as it slides away
  const [sharingFor, setSharingFor] = useState<{
    readonly versionNo: number
    readonly name: string
  } | null>(null)
  const [sharingOpen, setSharingOpen] = useState(false)
  // an example being written out, and what it starts from when a try opened it
  const [addingExample, setAddingExample] = useState(false)
  const [exampleSeed, setExampleSeed] = useState<{
    readonly drafts?: Readonly<Record<string, FieldDraft>>
    readonly expected?: string
  }>({})

  // which state of the formula is on screen - the draft, or a piece of its
  // history - kept in the address so a reload or back lands on it again
  const [viewParam, setViewParam] = usePageQueryState('view', '', { history: 'push' })
  const view = parseView(viewParam)
  // Only a press inside the page moves anything: arriving on a link straight
  // to a version is simply where the reader is, with nothing to slide in.
  const [motion, setMotion] = useState<'forward' | 'back' | null>(null)
  const showView = (next: WorkbenchView) => {
    setMotion(next.kind === 'draft' ? 'back' : 'forward')
    setViewParam(viewValue(next))
  }
  const [historyList, setHistoryList] = useState<HistoryList>('releases')
  const [phoneTab, setPhoneTab] = useState('source')
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishFailure, setPublishFailure] = useState<string | null>(null)
  const [nameProblem, setNameProblem] = useState<string | null>(null)
  // the one question a replacing action asks first, and what answering yes does
  const [confirming, setConfirming] = useState<{
    readonly title: string
    readonly description: string
    readonly confirmLabel: string
    readonly act: () => void
  } | null>(null)
  // apart from the question, so its words stay put while the dialog closes
  const [confirmOpen, setConfirmOpen] = useState(false)
  const ask = (question: NonNullable<typeof confirming>) => {
    setConfirming(question)
    setConfirmOpen(true)
  }

  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [tests, setTests] = useState<DraftTest[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [findings, setFindings] = useState<PublishFindings>({})

  // Whether the author has begun. A formula whose saved draft is empty opens
  // on the two ways to start instead of on an editor; once one is taken, the
  // editor stays even if every line is deleted again.
  const [started, setStarted] = useState(false)
  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  const [remoteMoved, setRemoteMoved] = useState(false)
  // edits this browser kept from an earlier visit, offered before anything else is kept
  const [localDraft, setLocalDraft] = useState<LocalDraft | null>(null)
  // bumps exactly when the buffer must ADOPT `source` (discard local, a
  // clean refetch); the editor never infers adoption from value changes
  const [editorSeed, setEditorSeed] = useState(0)

  // ---- the draft contract: what the CURRENT buffer compiles to ---------
  const fetchPreview = useCallback(
    (sourceTs: string) =>
      run(
        api.assessmentFormula.previewFormulaDraft({
          params: { functionId },
          payload: { sourceTs },
        }),
      ) as Promise<DraftContract>,
    [api, run, functionId],
  )
  // only the draft is ever compiled here: a publication or a saved revision
  // on screen is read as it was frozen, and asks the compiler nothing
  const preview = useDraftPreview(
    fn === undefined || view.kind !== 'draft' ? null : source,
    fetchPreview,
    formatError,
  )
  // nothing written yet - once the server's draft is in the editor, so the
  // empty buffer before it arrives is not mistaken for an empty formula
  const blank = fn !== undefined && baseRevision !== null && isBlankSource(source)
  // screens render from the last contract that compiled; running and saving
  // tests take their authority from preview.current alone. An emptied editor
  // has no structure, whatever it held before.
  const contract = blank ? null : (preview.lastGood?.contract ?? null)

  // per-row form drafts; the row's inputText stays the stored truth and
  // the drafts are the editing view over it. A changed contract identity
  // re-derives every view (legal stored values survive verbatim).
  const [rowDrafts, setRowDrafts] = useState<Record<string, Record<string, FieldDraft>>>({})
  const [rowIssues, setRowIssues] = useState<Record<string, ReadonlyMap<string, string>>>({})
  const [tryDrafts, setTryDrafts] = useState<Record<string, FieldDraft>>({})
  const [tryIssues, setTryIssues] = useState<ReadonlyMap<string, string> | undefined>(undefined)
  interface RunOutcome {
    readonly passed?: boolean
    readonly actual?: string
    readonly refusal?: string
    readonly defect?: string
    readonly problems?: unknown
    /** the buffer this ran against */
    readonly forSource: string
    /** the case (input + expectation) this ran; edits make it stale too */
    readonly forCase: string
    /** when it ran, for the try-run's own line */
    readonly at?: number
  }
  const [runResults, setRunResults] = useState<Record<string, RunOutcome>>({})
  /** which lines the run in flight is about, so each answers where it was pressed */
  const [runningKeys, setRunningKeys] = useState<readonly string[]>([])
  const [tryResult, setTryResult] = useState<RunOutcome | null>(null)
  const [running, setRunning] = useState(false)
  // the panel under the editor: which view it shows, and which cases are
  // open for editing there
  const [tab, setTab] = useState<PanelTab>('examples')
  // the case open in the sheet; kept after the sheet closes so its words
  // stay put while it slides away
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const openCase = (key: string) => {
    setEditingKey(key)
    setSheetOpen(true)
  }
  // A refused publish speaks about the source it compiled. Its compiler and
  // contract findings are shown while that is still the source on screen,
  // and not once the author has typed past them.
  const [findingsFor, setFindingsFor] = useState<string | null>(null)
  const publishedSource = useRef('')
  useEffect(() => {
    setRowDrafts({})
    setRowIssues({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract?.contractSha256])

  const fieldIssueText = (schema: AtomicSchema | undefined, reason: string): string =>
    fieldIssueWords(format, schema, reason)

  const translateIssues = (
    schema: DraftContract['inputSchema'],
    issues: ReadonlyMap<string, string>,
  ): ReadonlyMap<string, string> => inputIssueWords(format, schema, issues)

  const rowByKey = (key: string): DraftTest | undefined => tests.find((one) => one.key === key)

  const storedInput = (row: DraftTest | undefined): unknown => {
    if (row === undefined) return undefined
    try {
      return JSON.parse(row.inputText === '' ? '{}' : row.inputText)
    } catch {
      return undefined
    }
  }

  /** what a result answered: the exact case content at run time */
  const caseFingerprint = (row: DraftTest): string => JSON.stringify([row.inputText, row.expected])

  /** the row's editing view: live drafts, or the stored value redrawn */
  const draftsOfRow = (row: DraftTest): Record<string, FieldDraft> =>
    rowDrafts[row.key] ??
    (contract === null ? {} : draftsFromStored(contract.inputSchema, storedInput(row)))

  const editRow = (row: DraftTest, name_: string, draft: FieldDraft) => {
    if (contract === null) return
    const next = { ...draftsOfRow(row), [name_]: draft }
    setRowDrafts((previous) => ({ ...previous, [row.key]: next }))
    const materialized = materializeInput(contract.inputSchema, next)
    if (materialized.value !== null) {
      setTests(
        tests.map((one) =>
          one.key === row.key ? { ...one, inputText: JSON.stringify(materialized.value) } : one,
        ),
      )
      setRowIssues((previous) => {
        const { [row.key]: _dropped, ...rest } = previous
        return rest
      })
      return
    }
    setRowIssues((previous) => ({
      ...previous,
      [row.key]: translateIssues(contract.inputSchema, materialized.issues),
    }))
  }

  /** the expected value judged against the output contract; '' = not yet given */
  const expectedIssueOf = (row: DraftTest, against: DraftContract | null): string | null => {
    if (against === null || row.expected === '') return null
    const outcome = materializeField(against.outputSchema, row.expected)
    if (outcome.kind === 'invalid') return fieldIssueText(against.outputSchema, outcome.reason)
    if (outcome.kind === 'empty') return null
    const wrong = validateValue(against.outputSchema, outcome.value)
    return wrong.length === 0 ? null : fieldIssueText(against.outputSchema, wrong[0]!.reason)
  }

  /** whether a row's STORED case satisfies a given contract, output included */
  const rowLegalAgainst = (row: DraftTest, against: DraftContract | null): boolean => {
    if (against === null) return true
    const stored = storedInput(row)
    if (stored === undefined) return false
    if (validateValue(against.inputSchema, stored).length > 0) return false
    return expectedIssueOf(row, against) === null
  }

  const rowLegal = (row: DraftTest): boolean => rowLegalAgainst(row, contract)

  // ---- one evaluator, always against a FROZEN snapshot -----------------
  // ensureFresh may resolve for a newer buffer than the click; the run then
  // uses that newer pair wholesale - schema and source always travel
  // together, and results are stamped with what they actually ran.
  interface RunSnapshot {
    readonly sourceTs: string
    readonly contract: DraftContract
  }
  const freezeForRun = async (): Promise<RunSnapshot | null> => {
    const fresh = await preview.ensureFresh()
    if (fresh.status !== 'ready') {
      // a press that cannot run says why: silence reads as a broken button
      toast.info(format(isBlankSource(source) ? m.runNeedsSource : m.runNeedsCompile))
      return null
    }
    return { sourceTs: fresh.source, contract: fresh.contract }
  }

  const evaluate = async (
    sourceTs: string,
    cases: readonly { clientId: string; input: unknown; expected?: string }[],
  ) => {
    const outcome = (await run(
      api.assessmentFormula.evaluateFormulaDraft({
        params: { functionId },
        payload: { sourceTs, cases },
      }),
    )) as {
      cases: readonly {
        clientId: string
        passed?: boolean
        actual?: string
        refusal?: string
        defect?: string
        problems?: unknown
      }[]
    }
    return outcome.cases
  }

  const runRows = async (keys: readonly string[]) => {
    setRunning(true)
    setRunningKeys(keys)
    setFailure(null)
    try {
      const snapshot = await freezeForRun()
      if (snapshot === null) return
      // capture each runnable row's content NOW; later edits mark results
      // stale rather than confusing what actually ran
      const frozen = keys
        .map((key) => rowByKey(key))
        .filter((row): row is DraftTest => row !== undefined)
        .map((row) => ({
          key: row.key,
          fingerprint: caseFingerprint(row),
          input: storedInput(row),
          expected: row.expected,
        }))
        .filter((row) => row.input !== undefined)
      if (frozen.length === 0) return
      const answers = await evaluate(
        snapshot.sourceTs,
        frozen.map((row) => ({
          clientId: row.key,
          input: row.input,
          ...(row.expected === '' ? {} : { expected: row.expected }),
        })),
      )
      const byKey = new Map(frozen.map((row) => [row.key, row]))
      setRunResults((previous) => {
        const next = { ...previous }
        for (const answer of answers) {
          const asked = byKey.get(answer.clientId)
          if (asked === undefined) continue
          next[answer.clientId] = {
            ...answer,
            forSource: snapshot.sourceTs,
            forCase: asked.fingerprint,
          }
        }
        return next
      })
    } catch (error) {
      setFailure(formatError(error))
    } finally {
      setRunning(false)
      setRunningKeys([])
    }
  }

  const runTry = async () => {
    setRunning(true)
    setFailure(null)
    setTryIssues(undefined)
    try {
      const snapshot = await freezeForRun()
      if (snapshot === null) return
      const frozenDrafts = { ...tryDrafts }
      const materialized = materializeInput(snapshot.contract.inputSchema, frozenDrafts)
      if (materialized.value === null) {
        setTryIssues(translateIssues(snapshot.contract.inputSchema, materialized.issues))
        return
      }
      const answers = await evaluate(snapshot.sourceTs, [
        { clientId: 'try', input: materialized.value },
      ])
      const answer = answers[0]!
      tryRecords.add({
        input: materialized.value,
        outcome: {
          ...(answer.actual === undefined ? {} : { actual: answer.actual }),
          ...(answer.refusal === undefined ? {} : { refusal: answer.refusal }),
          ...(answer.defect === undefined ? {} : { defect: answer.defect }),
        },
        mark: sourceMark(snapshot.sourceTs),
      })
      setTryResult({
        ...answers[0]!,
        at: Date.now(),
        forSource: snapshot.sourceTs,
        forCase: JSON.stringify(frozenDrafts),
      })
    } catch (error) {
      setFailure(formatError(error))
    } finally {
      setRunning(false)
    }
  }

  /** a try result speaks for the current screen only while neither the
   * code nor the inputs moved; a stale actual may NOT become an expected */
  const tryStale = (outcome: RunOutcome): boolean =>
    outcome.forSource !== source || outcome.forCase !== JSON.stringify(tryDrafts)

  const saveTryAsCase = (expected: string) => {
    if (contract === null) return
    const materialized = materializeInput(contract.inputSchema, tryDrafts)
    if (materialized.value === null) {
      setTryIssues(translateIssues(contract.inputSchema, materialized.issues))
      return
    }
    setTests([
      ...tests,
      { key: newTestKey(), name: '', inputText: JSON.stringify(materialized.value), expected },
    ])
  }

  const loadIntoTry = (row: DraftTest) => {
    if (contract === null) return
    setTryDrafts(draftsFromStored(contract.inputSchema, storedInput(row)))
    setTryIssues(undefined)
    setTryResult(null)
  }

  const seededTests = (loaded: NonNullable<typeof fn>) =>
    loaded.draftTests.map((test) => ({
      key: newTestKey(),
      name: test.name,
      inputText: JSON.stringify(test.input),
      expected: test.expected,
    }))

  /** takes the server's draft as the editor's, dropping what was held locally */
  const adopt = (loaded: NonNullable<typeof fn>) => {
    setName(loaded.name)
    setSource(loaded.draftSourceTs)
    if (!isBlankSource(loaded.draftSourceTs)) setStarted(true)
    setTests(seededTests(loaded))
    setBaseRevision(loaded.draftRevision)
    setRemoteMoved(false)
    setEditorSeed((seed) => seed + 1)
  }

  const differsFromServer = (
    loaded: NonNullable<typeof fn>,
    held: { readonly name: string; readonly source: string; readonly tests: readonly unknown[] },
  ): boolean =>
    held.name.trim() !== loaded.name ||
    held.source !== loaded.draftSourceTs ||
    JSON.stringify(held.tests) !== JSON.stringify(bareTests(seededTests(loaded)))

  // The editor follows the server draft only while it holds nothing of its
  // own. The first arrival is adopted; a revision this page saved itself is
  // already the editor's; a revision somebody else saved is followed when
  // there is nothing unsaved here, and otherwise raises the banner and leaves
  // the text alone.
  useEffect(() => {
    if (fn === undefined) return
    if (baseRevision === null) {
      adopt(fn)
      // edits this browser kept, from a visit that ended before they were saved
      const loaded = fn
      void readLocalDraft(loaded.id).then((kept) => {
        if (kept === null) return
        if (differsFromServer(loaded, { ...kept, tests: kept.tests })) setLocalDraft(kept)
        else void forgetLocalDraft(loaded.id)
      })
      return
    }
    if (fn.draftRevision === baseRevision) return
    if (differsFromServer(fn, { name, source, tests: bareTests(tests) })) {
      setRemoteMoved(true)
      return
    }
    adopt(fn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn?.id, fn?.draftRevision])

  const discardLocal = () => {
    if (fn === undefined) return
    adopt(fn)
  }

  /** puts the edits this browser kept back into the editor, as one undoable step */
  const takeLocalDraft = () => {
    if (fn === undefined || localDraft === null) return
    setName(localDraft.name)
    setSource(localDraft.source)
    setTests(localDraft.tests.map((test) => ({ key: newTestKey(), ...test })))
    setBaseRevision(localDraft.baseRevision)
    setRemoteMoved(localDraft.baseRevision !== fn.draftRevision)
    setEditorSeed((seed) => seed + 1)
    setLocalDraft(null)
  }

  const dropLocalDraft = () => {
    if (fn !== undefined) void forgetLocalDraft(fn.id)
    setLocalDraft(null)
  }

  type ParsedTests =
    | { readonly tests: { name: string; input: unknown; expected: string }[] }
    | { readonly invalidLabel: string }

  const parsedTests = (): ParsedTests => {
    const collected: { name: string; input: unknown; expected: string }[] = []
    for (const [index, test] of tests.entries()) {
      try {
        collected.push({
          name: test.name,
          input: JSON.parse(test.inputText === '' ? '{}' : test.inputText) as unknown,
          expected: test.expected,
        })
      } catch {
        return { invalidLabel: test.name === '' ? `#${index + 1}` : test.name }
      }
    }
    return { tests: collected }
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.assessmentFormula.key() })

  // the two dirts, apart on purpose: big code edits may leave cases
  // temporarily broken, and that must never hold the CODE hostage
  const nameDirty = (): boolean => (fn === undefined ? false : name.trim() !== fn.name)
  const sourceChanged = (): boolean => (fn === undefined ? false : source !== fn.draftSourceTs)
  const sourceDirty = (): boolean => nameDirty() || sourceChanged()
  const testsDirty = (): boolean =>
    fn === undefined
      ? false
      : JSON.stringify(bareTests(tests)) !== JSON.stringify(bareTests(seededTests(fn)))
  const dirty = (): boolean => sourceDirty() || testsDirty()

  /** every row satisfies a given contract, expectation included */
  const allRowsLegalAgainst = (against: DraftContract): boolean =>
    tests.every((row) => rowLegalAgainst(row, against))

  /** tests may only claim contract-checked when the preview is READY for
   * the exact buffer on screen; the lastGood convenience never qualifies */
  const testsSaveable = (): boolean =>
    preview.current.status === 'ready' &&
    preview.current.source === source &&
    allRowsLegalAgainst(preview.current.contract)

  interface SavePatch {
    readonly name: string | null
    readonly source: string | null
    readonly tests: { name: string; input: unknown; expected: string }[] | null
  }

  // a real PATCH: only what changed travels, so a clean save is a business
  // no-op instead of a new revision and a new audit row
  const saveEffect = (patch: SavePatch) =>
    run(
      api.assessmentFormula.updateFormulaDraft({
        params: { functionId },
        payload: {
          expectedDraftRevision: baseRevision ?? fn!.draftRevision,
          ...(patch.name === null ? {} : { name: patch.name }),
          ...(patch.source === null ? {} : { draftSourceTs: patch.source }),
          ...(patch.tests === null ? {} : { draftTests: patch.tests }),
        },
      }),
    )

  const save = useMutation({
    mutationFn: (patch: SavePatch) => saveEffect(patch),
    onMutate: () => setFailure(null),
    onSuccess: async (result: { function: { draftRevision: number } }) => {
      // this page's own save: the revision it made is already the editor's,
      // so the refetch below adopts nothing over what was typed meanwhile
      setBaseRevision(result.function.draftRevision)
      toast.success(format(m.saved))
      await refresh()
    },
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  // local validation stays OUT of the mutation: a malformed example is this
  // screen's own finding, named precisely, never blurred into the generic
  // api-failure copy (measured: it read as "something went wrong" with no
  // request ever sent, which explained nothing)
  const saveDraft = () => {
    if (view.kind !== 'draft') return
    const wantTests = testsDirty()
    const canTests = wantTests && testsSaveable()
    const patchName = nameDirty() ? (name.trim() === '' ? fn!.name : name.trim()) : null
    const patchSource = sourceChanged() ? source : null
    if (wantTests && !canTests) toast.info(format(m.testsHeldBack))
    if (patchName === null && patchSource === null && !canTests) return
    let collected: SavePatch['tests'] = null
    if (canTests) {
      const parsed = parsedTests()
      if ('invalidLabel' in parsed) {
        setFailure(format(m.testInputInvalid, { label: parsed.invalidLabel }))
        return
      }
      collected = parsed.tests
    }
    save.mutate({ name: patchName, source: patchSource, tests: collected })
  }
  // Unsaved edits are kept in this browser a moment after they stop, and let
  // go once nothing is unsaved. While an earlier visit's edits are still on
  // offer, they are not overwritten by this one's.
  const keepNow = useRef<() => void>(() => {})
  keepNow.current = () => {
    if (fn === undefined || baseRevision === null || localDraft !== null) return
    if (dirty())
      void keepLocalDraft({
        functionId: fn.id,
        name,
        source,
        tests: bareTests(tests),
        baseRevision,
        keptAt: Date.now(),
      })
    else void forgetLocalDraft(fn.id)
  }
  useEffect(() => {
    const timer = setTimeout(() => keepNow.current(), 800)
    return () => clearTimeout(timer)
  }, [name, source, tests, baseRevision, localDraft, fn])
  // and at once when the window is put away, which may be the last chance
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') keepNow.current()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // the whole page saves on Cmd/Ctrl+S, wherever focus sits - code, name,
  // a test field; capture-phase so Monaco cannot swallow it first
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault()
        saveDraftRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // closing or reloading the tab with unsaved work asks first; in-app
  // navigation guarding waits for a data router (BrowserRouter has no
  // blocker seam)
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current()) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const publish = useMutation({
    // publishing compiles the draft the SERVER holds, so unsaved edits are
    // saved first - otherwise the button quietly proves yesterday's bytes.
    // The dialog says so before it is pressed.
    mutationFn: async (release: { readonly name: string; readonly notes: string }) => {
      publishedSource.current = source
      let revision = baseRevision ?? fn!.draftRevision
      if (dirty()) {
        // publication needs the whole draft coherent: tests that changed
        // must be checkable against the CURRENT buffer's contract
        if (testsDirty() && !testsSaveable())
          return Promise.reject(new LocalFinding(format(m.testsHeldBack)))
        const parsed = parsedTests()
        if ('invalidLabel' in parsed)
          return Promise.reject(
            new LocalFinding(format(m.testInputInvalid, { label: parsed.invalidLabel })),
          )
        const savedNow = (await saveEffect({
          name: nameDirty() ? (name.trim() === '' ? fn!.name : name.trim()) : null,
          source: sourceChanged() ? source : null,
          tests: testsDirty() ? parsed.tests : null,
        })) as {
          function: { draftRevision: number }
        }
        revision = savedNow.function.draftRevision
        setBaseRevision(revision)
      }
      return run(
        api.assessmentFormula.publishFormulaVersion({
          params: { functionId },
          payload: {
            expectedDraftRevision: revision,
            releaseName: release.name,
            ...(release.notes === '' ? {} : { releaseNotes: release.notes }),
          },
        }),
      )
    },
    onMutate: () => {
      setFailure(null)
      setFindings({})
      setPublishFailure(null)
      setNameProblem(null)
    },
    onSuccess: async (result: { version: { versionNo: number; releaseName: string | null } }) => {
      setPublishOpen(false)
      setHistoryList('releases')
      toast.success(format(m.publishedAs, { name: result.version.releaseName ?? '' }))
      await refresh()
    },
    onError: async (error: unknown) => {
      // a name somebody else's publication wears is the dialog's to answer:
      // it stays open on the name to change
      if (tagOf(error) === 'ASSESSMENT_FORMULA_RELEASE_NAME_TAKEN') {
        setNameProblem(formatError(error))
        await refresh()
        return
      }
      setPublishOpen(false)
      setFailure(error instanceof LocalFinding ? error.message : formatError(error))
      const carried = findingsOf(error)
      setFindings(carried)
      setFindingsFor(publishedSource.current)
      // The examples the server ran are the ones on screen - publishing saved
      // them first - so its verdicts land on their rows, stamped with the
      // source they ran against like any other run. A list that no longer
      // lines up by name is left alone rather than guessed onto.
      const report = carried.report
      if (
        report !== undefined &&
        report.length === tests.length &&
        report.every((row, index) => row.name === tests[index]!.name)
      ) {
        setRunResults((previous) => {
          const next = { ...previous }
          report.forEach((row, index) => {
            const test = tests[index]!
            next[test.key] = {
              passed: row.passed,
              ...(row.actual === undefined ? {} : { actual: row.actual }),
              ...(row.refusal === undefined ? {} : { refusal: row.refusal }),
              ...(row.defect === undefined ? {} : { defect: row.defect }),
              ...(row.problems === undefined ? {} : { problems: row.problems }),
              forSource: publishedSource.current,
              forCase: caseFingerprint(test),
            }
          })
          return next
        })
      }
      // open the view that holds the reason
      if ((carried.diagnostics?.length ?? 0) > 0) {
        setTab('compile')
        setPhoneTab('source')
      } else if ((carried.issues?.length ?? 0) > 0) {
        setTab('contract')
        setPhoneTab('try')
      } else if ((carried.report?.length ?? 0) > 0) {
        setTab('examples')
        setPhoneTab('examples')
      }
      // the auto-save may have landed even though publishing was refused;
      // without a refresh the editor still holds the old revision and the
      // next save would conflict with its own work
      await refresh()
    },
  })

  const restore = useMutation({
    mutationFn: (from: RestoreFrom) =>
      run(
        api.assessmentFormula.restoreFormulaDraft({
          params: { functionId },
          payload: { expectedDraftRevision: baseRevision ?? fn!.draftRevision, from },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: async (result: { function: NonNullable<typeof fn> }) => {
      adopt(result.function)
      showView({ kind: 'draft' })
      setPhoneTab('source')
      toast.success(format(m.restored))
      await refresh()
    },
    // restoring is pressed from a piece of history, which has no notice
    // line of its own
    onError: (error: unknown) => toast.error(formatError(error)),
  })

  /**
   * Puts an earlier state back as the draft. Nothing is lost by it - the
   * draft as it stands is already a saved revision - unless there are edits
   * that were never saved, and then it asks first.
   */
  const restoreFrom = (from: RestoreFrom, fromWords: string) => {
    if (!dirty()) {
      restore.mutate(from)
      return
    }
    ask({
      title: format(m.replaceDraftTitle),
      description: format(m.replaceDraftDescription, { name: fromWords }),
      confirmLabel: format(m.replaceDraftConfirm),
      act: () => restore.mutate(from),
    })
  }

  /** the smallest example, into the editor only; saving it is the author's call */
  const loadExample = () => {
    const put = () => {
      setSource(MINIMAL_EXAMPLE)
      setEditorSeed((seed) => seed + 1)
      setStarted(true)
      setPhoneTab('source')
    }
    if (isBlankSource(source)) {
      put()
      return
    }
    ask({
      title: format(m.loadExampleTitle),
      description: format(m.loadExampleDescription),
      confirmLabel: format(m.loadExampleConfirm),
      act: put,
    })
  }

  const downloadCurrent = () => {
    const filename = fileNameOf([name.trim() === '' ? fn?.name : name], '.ts')
    downloadText({ filename, text: source, type: 'text/typescript;charset=utf-8' })
    toast.success(format(m.downloaded, { file: filename }))
  }

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      run(
        api.assessmentFormula.setFormulaFunctionStatus({
          params: { functionId },
          payload: { status },
        }),
      ),
    onSuccess: async (_result: unknown, status: 'active' | 'archived') => {
      toast.success(format(status === 'archived' ? m.archived : m.unarchived))
      await refresh()
    },
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  /** archiving takes the formula out of new bindings and out of editing, so it asks first */
  const archiveFormula = () =>
    ask({
      title: format(m.archiveTitle),
      description: format(m.archiveDescription),
      confirmLabel: format(m.archiveConfirm),
      act: () => setStatus.mutate('archived'),
    })

  // Escape from a piece of history comes back to the draft, unless a dialog,
  // menu or card above the page, or the editor itself, is what Escape is for.
  // Asked in the capture phase, before any of those has closed itself and
  // left the page to mistake the same press for its own.
  const viewKindRef = useRef(view.kind)
  viewKindRef.current = view.kind
  const backRef = useRef(() => showView({ kind: 'draft' }))
  backRef.current = () => showView({ kind: 'draft' })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (viewKindRef.current === 'draft') return
      if (event.target instanceof Element && event.target.closest('.monaco-editor') !== null) return
      if (document.querySelector('[role="dialog"], [role="menu"], [data-slot="popover-content"]'))
        return
      backRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // a load that fails after the formula arrived keeps the page; only a first load that fails replaces it
  if (detail.isError && fn === undefined) {
    return (
      <PageContainer>
        <EmptyRow role="alert">{format(m.loadFailed)}</EmptyRow>
      </PageContainer>
    )
  }
  if (fn === undefined) {
    return (
      <div {...stylex.props(styles.frame)} aria-busy>
        <div {...stylex.props(styles.skeleton)}>
          <Skeleton height={16} width={220} radius={4} />
          <Skeleton height={14} width="40%" radius={4} />
          <Skeleton height={14} width="60%" radius={4} />
          <Skeleton height={14} width="30%" radius={4} />
        </div>
      </div>
    )
  }

  const archived = fn.status === 'archived'
  const busy = save.isPending || publish.isPending || restore.isPending
  const releases = [...versions].sort((a, b) => b.versionNo - a.versionNo)
  const releaseWords = (release: { versionNo: number; releaseName: string | null }): string =>
    release.releaseName ?? format(m.releaseOrdinal, { number: release.versionNo })

  // the versions, wherever the workbench is showing them from
  const versionsDrawer = (
    <VersionsDrawer
      open={versionsOpen}
      onOpenChange={setVersionsOpen}
      narrow={narrow}
      functionId={functionId}
      releases={releases}
      latestVersionNo={fn.latestVersionNo}
      draftRevision={fn.draftRevision}
      view={view}
      onView={showView}
      list={historyList}
      onList={setHistoryList}
      archived={archived}
      restoring={restore.isPending}
      onRestoreRelease={(release) =>
        restoreFrom({ kind: 'published-version', versionNo: release.versionNo }, release.name)
      }
      onRestoreRevision={(revisionNo) =>
        restoreFrom(
          { kind: 'draft-revision', revisionNo },
          format(m.revisionNumber, { number: revisionNo }),
        )
      }
      onShare={(release) => {
        setSharingFor({ versionNo: release.versionNo, name: releaseWords(release) })
        setSharingOpen(true)
      }}
    />
  )

  // mounted from the first press onwards, and kept through its own closing so
  // its words stay put as it slides away
  const sharingDialog =
    sharingFor === null ? null : (
      <VersionSharingDialog
        open={sharingOpen}
        functionId={functionId}
        version={sharingFor}
        onClose={() => setSharingOpen(false)}
        onSaved={() => void refresh()}
      />
    )

  /** the bar's way into the versions, which every view carries */
  const versionsButton = (
    <Button
      variant="ghost"
      size="sm"
      data-testid="formula-versions-open"
      onClick={() => setVersionsOpen(true)}
    >
      <HistoryIcon aria-hidden />
      {format(m.historyTitle)}
      {releases.length === 0 ? null : (
        <span {...stylex.props(styles.actionCount)}>{releases.length}</span>
      )}
    </Button>
  )

  const confirmDialog = (
    <ConfirmDialog
      open={confirmOpen}
      title={confirming?.title ?? ''}
      {...(confirming === null ? {} : { description: confirming.description })}
      confirmLabel={confirming?.confirmLabel ?? ''}
      cancelLabel={format(m.cancel)}
      onConfirm={() => {
        setConfirmOpen(false)
        confirming?.act()
      }}
      onCancel={() => setConfirmOpen(false)}
    />
  )

  // a piece of the history, read-only in the same frame; the draft and its
  // unsaved edits wait here for the way back
  if (view.kind === 'release') {
    return (
      <>
        <ReleaseView
          key={`release-${String(view.versionNo)}`}
          functionId={functionId}
          functionName={fn.name}
          versionNo={view.versionNo}
          latestVersionNo={fn.latestVersionNo}
          archived={archived}
          narrow={narrow}
          titleRef={titleRef}
          lease={editorLease}
          versionsButton={versionsButton}
          drawers={
            <>
              {versionsDrawer}
              {sharingDialog}
            </>
          }
          {...(motion === 'forward' ? { motion: 'forward' as const } : {})}
          onBack={() => showView({ kind: 'draft' })}
          onRestore={(release) =>
            restoreFrom({ kind: 'published-version', versionNo: release.versionNo }, release.name)
          }
          restoring={restore.isPending}
        />
        {confirmDialog}
      </>
    )
  }
  if (view.kind === 'revision') {
    return (
      <>
        <RevisionView
          key={`revision-${String(view.revisionNo)}`}
          functionId={functionId}
          functionName={fn.name}
          revisionNo={view.revisionNo}
          draftRevision={fn.draftRevision}
          archived={archived}
          narrow={narrow}
          titleRef={titleRef}
          lease={editorLease}
          versionsButton={versionsButton}
          drawers={
            <>
              {versionsDrawer}
              {sharingDialog}
            </>
          }
          {...(motion === 'forward' ? { motion: 'forward' as const } : {})}
          onBack={() => showView({ kind: 'draft' })}
          onRestore={(revisionNo) =>
            restoreFrom(
              { kind: 'draft-revision', revisionNo },
              format(m.revisionNumber, { number: revisionNo }),
            )
          }
          restoring={restore.isPending}
        />
        {confirmDialog}
      </>
    )
  }

  // What stands against the source on screen: the preview's own refusal,
  // which carries the compiler's findings, and a refused publish of the
  // same source. A contract refusal means the code compiled and its
  // parameters did not pass - the compile view is clean, the parameter
  // view is not.
  const previewCause =
    preview.current.status === 'refused' && preview.current.source === source
      ? preview.current.cause
      : undefined
  const previewFindings = previewCause === undefined ? {} : findingsOf(previewCause)
  const contractRefused = tagOf(previewCause) === 'ASSESSMENT_FORMULA_CONTRACT_INVALID'
  const findingsHeld = findingsFor === source
  const held = (pick: (from: PublishFindings) => readonly unknown[] | undefined) =>
    findingsHeld && (pick(findings)?.length ?? 0) > 0 ? findings : previewFindings
  const diagnostics = held((from) => from.diagnostics).diagnostics ?? []
  const issues = held((from) => from.issues).issues ?? []
  const contractDetail =
    findingsHeld && findings.detail !== undefined ? findings.detail : previewFindings.detail
  const packagerWords =
    findingsHeld && findings.packager !== undefined ? findings.packager : previewFindings.packager

  // the draft contract, as the try-run and the tabs speak of it
  const structure: 'blank' | 'synced' | 'refused' | 'loading' | 'stale' = blank
    ? 'blank'
    : preview.current.status === 'ready' && preview.current.source === source
      ? 'synced'
      : preview.current.status === 'refused' && preview.current.source === source
        ? 'refused'
        : contract === null
          ? 'loading'
          : 'stale'
  const structureWords = format(
    {
      blank: m.compileBlank,
      synced: m.structureSynced,
      // a form drawn from the last structure that compiled says so, and says
      // which of the two checks refused the one on screen
      refused: contractRefused
        ? contract === null
          ? m.structureContractRefused
          : m.structureContractKept
        : contract === null
          ? m.structureRefused
          : m.structureKept,
      loading: m.structureLoading,
      stale: m.structureStale,
    }[structure],
  )
  const refusalWords = preview.current.status === 'refused' ? preview.current.refusal : null

  const compileState: 'blank' | 'passed' | 'failed' | 'working' = blank
    ? 'blank'
    : diagnostics.length > 0 || (structure === 'refused' && !contractRefused)
      ? 'failed'
      : structure === 'synced' || structure === 'refused'
        ? 'passed'
        : 'working'

  // every case with what it came to, once, for the rows, the tab and the foot
  const cases = tests.map((test, index) => {
    const outcome = runResults[test.key]
    const stale =
      outcome !== undefined &&
      (outcome.forSource !== source || outcome.forCase !== caseFingerprint(test))
    const legal = rowLegal(test)
    const fresh = outcome !== undefined && !stale
    const verdict: Verdict = fresh
      ? outcome.passed === true
        ? 'passed'
        : outcome.passed === false || outcome.refusal !== undefined || outcome.defect !== undefined
          ? 'failed'
          : 'unexpected'
      : legal
        ? 'not-run'
        : 'fix'
    return {
      test,
      index,
      outcome,
      stale,
      legal,
      verdict,
      label: test.name === '' ? `#${String(index + 1)}` : test.name,
    }
  })
  const examplesTone: Tone = cases.some((one) => one.verdict === 'failed' || one.verdict === 'fix')
    ? 'bad'
    : cases.length > 0 && cases.every((one) => one.verdict === 'passed')
      ? 'good'
      : running || cases.some((one) => one.verdict === 'not-run')
        ? 'working'
        : 'quiet'
  // While the compiler is being asked again the answer is unknown, and saying
  // so is steadier than taking the dot away and putting it back.
  const compileTone: Tone =
    compileState === 'failed'
      ? 'bad'
      : compileState === 'passed'
        ? 'good'
        : compileState === 'working'
          ? 'working'
          : 'quiet'
  const contractTone: Tone =
    issues.length > 0
      ? 'bad'
      : structure === 'synced'
        ? 'good'
        : structure === 'blank'
          ? 'quiet'
          : 'working'

  // the foot of the examples: the first thing standing between the draft
  // and a publication, and the one step that settles it when there is one
  const failed = cases.find((one) => one.verdict === 'failed')
  const toFix = cases.find((one) => one.verdict === 'fix')
  const unexpected = cases.find((one) => one.verdict === 'unexpected')
  const notRun = cases.filter((one) => one.verdict === 'not-run').length
  const adoptable =
    failed?.outcome?.actual !== undefined &&
    failed.outcome.passed === false &&
    failed.outcome.refusal === undefined &&
    failed.outcome.defect === undefined
      ? { key: failed.test.key, actual: failed.outcome.actual }
      : unexpected?.outcome?.actual !== undefined
        ? { key: unexpected.test.key, actual: unexpected.outcome.actual }
        : null
  const summary =
    cases.length === 0
      ? format(m.examplesEmpty)
      : failed !== undefined
        ? failed.outcome?.actual !== undefined
          ? format(m.exampleFailedActual, { name: failed.label, actual: failed.outcome.actual })
          : format(m.exampleFailed, { name: failed.label })
        : toFix !== undefined
          ? format(m.exampleNeedsFixing, { name: toFix.label })
          : unexpected !== undefined
            ? format(m.exampleNoExpectation, { name: unexpected.label })
            : notRun > 0
              ? format(m.examplesNotRun, { count: notRun })
              : format(m.examplesAllPassed)

  // Whether the SAVED draft is exactly what was last published - source and
  // examples both. Said beside the draft's own state, and apart from the
  // name of the latest publication, so a saved draft is never read as the
  // publication itself.
  const releaseRelation: 'same' | 'ahead' | 'none' =
    fn.latestVersionNo === null || latestRelease.data === undefined
      ? 'none'
      : latestRelease.data.version.sourceTs === fn.draftSourceTs &&
          canonicalJson(latestRelease.data.version.tests) === canonicalJson(fn.draftTests)
        ? 'same'
        : 'ahead'

  const saveState = publish.isPending
    ? 'publishing'
    : save.isPending
      ? 'saving'
      : dirty()
        ? 'dirty'
        : 'clean'

  const canPublish = !archived && !busy && !blank

  const openPublish = () => {
    setPublishFailure(null)
    setNameProblem(null)
    setPublishOpen(true)
  }

  const addCase = () => {
    setExampleSeed({})
    setAddingExample(true)
  }

  const editCase = (key: string, change: Partial<Omit<DraftTest, 'key'>>) =>
    setTests(tests.map((one) => (one.key === key ? { ...one, ...change } : one)))

  /** one part of a case, under its own heading, so the three do not run together */
  const casePart = (title: string, body: ReactNode) => (
    <section {...stylex.props(styles.casePart)}>
      <h3 {...stylex.props(styles.casePartTitle)}>{title}</h3>
      <div {...stylex.props(styles.casePartBody)}>{body}</div>
    </section>
  )

  const caseFields = (test: DraftTest, legal: boolean) => {
    const expectedProblem = expectedIssueOf(test, contract)
    return (
      <>
        {casePart(
          format(m.testName),
          <Field label={format(m.testName)} hideLabel>
            {(id) => (
              <Input
                id={id}
                value={test.name}
                disabled={archived}
                placeholder={format(m.exampleNamePlaceholder)}
                onChange={(event) => editCase(test.key, { name: event.target.value })}
              />
            )}
          </Field>,
        )}
        {casePart(
          format(m.testInput),
          contract === null ? (
            <Field label={format(m.testInput)} hideLabel>
              {(id) => (
                <Input
                  id={id}
                  placeholder={'{"value": "2.34"}'}
                  value={test.inputText}
                  disabled={archived}
                  onChange={(event) => editCase(test.key, { inputText: event.target.value })}
                />
              )}
            </Field>
          ) : (
            <InputValueForm
              schema={contract.inputSchema}
              drafts={draftsOfRow(test)}
              onDraft={(name_, draft) => editRow(test, name_, draft)}
              locale={locale}
              disabled={archived}
              problems={rowIssues[test.key]}
              scope={`case-${test.key}`}
              authoring={{
                unnamedLabel: format(m.fieldUnnamed),
                noteOf: (field) => constraintNote(field, format, locale),
              }}
            />
          ),
        )}
        {casePart(
          format(m.expectedLabel),
          contract === null ? (
            <Field label={format(m.expectedLabel)} hideLabel>
              {(id) => (
                <Input
                  id={id}
                  placeholder={format(m.expectedLabel)}
                  value={test.expected}
                  disabled={archived}
                  onChange={(event) => editCase(test.key, { expected: event.target.value })}
                />
              )}
            </Field>
          ) : (
            // the expectation faces the OUTPUT contract like inputs face the
            // input contract; '' stays legal until publish
            <AtomicValueField
              schema={contract.outputSchema}
              name={`expected-${test.key}`}
              label={format(m.expectedLabel)}
              draft={test.expected}
              onDraft={(draft) =>
                editCase(test.key, { expected: typeof draft === 'string' ? draft : String(draft) })
              }
              locale={locale}
              disabled={archived}
              {...(expectedProblem === null ? {} : { problem: expectedProblem })}
            />
          ),
        )}
        {legal ? null : (
          <p {...stylex.props(styles.problemLine)} role="alert">
            {format(m.testRowInvalid)}
          </p>
        )}
      </>
    )
  }

  const editingCase = cases.find((one) => one.test.key === editingKey)

  // ---- the bar ------------------------------------------------------------

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="formula-more"
          aria-label={format(m.moreActions)}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={archived} onSelect={loadExample}>
          {format(m.loadExampleMenu)}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={blank} onSelect={downloadCurrent}>
          {format(m.downloadCurrent)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={setStatus.isPending}
          onSelect={() => (archived ? setStatus.mutate('active') : archiveFormula())}
        >
          {format(archived ? m.restoreFormula : m.archiveFormula)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const saveHint = archived
    ? format(m.saveArchivedHint)
    : busy
      ? null
      : dirty()
        ? format(m.saveShortcutHint)
        : format(m.saveCleanHint)
  const saveButton = (
    <Hinted hint={saveHint} wide={narrow}>
      <Button
        variant="outline"
        size={narrow ? 'lg' : 'sm'}
        data-testid="formula-save"
        disabled={archived || busy || !dirty()}
        onClick={saveDraft}
        className={narrow ? stylex.props(styles.wide).className : undefined}
      >
        {narrow ? null : <SaveIcon aria-hidden />}
        {format(m.save)}
      </Button>
    </Hinted>
  )

  const publishHint = archived
    ? format(m.saveArchivedHint)
    : blank
      ? format(m.publishBlankHint)
      : format(m.publishHint)
  // publishing is what the page is for, so it stands in the bar rather than
  // in a menu, and on a phone beside saving at the foot
  const publishButton = (
    <Hinted hint={publishHint} wide={narrow}>
      <Button
        size={narrow ? 'lg' : 'sm'}
        data-testid="formula-publish-open"
        disabled={!canPublish}
        onClick={openPublish}
        className={narrow ? stylex.props(styles.wide).className : undefined}
      >
        {narrow ? null : <UploadIcon aria-hidden />}
        {format(m.publishOpen)}
      </Button>
    </Hinted>
  )

  const bar = (
    <WorkbenchBar
      narrow={narrow}
      backLabel={format(m.listTitle)}
      titleRef={titleRef}
      title={
        <label
          {...stylex.props(styles.nameEdit, nameDirty() && styles.nameEditDirty)}
          data-dirty={nameDirty() ? true : undefined}
        >
          <input
            aria-label={format(m.nameLabel)}
            value={name}
            disabled={archived}
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
            style={{ width: nameWidth(name) }}
            {...stylex.props(styles.name, nameDirty() && styles.nameDirty)}
          />
          {archived ? null : (
            <PencilIcon size={13} aria-hidden {...stylex.props(styles.nameGlyph)} />
          )}
        </label>
      }
      badge={
        <span
          data-testid="formula-standing"
          {...stylex.props(
            w.standing,
            archived
              ? w.standingOutline
              : fn.latestVersionNo === null
                ? w.standingQuiet
                : w.standingGood,
          )}
        >
          {archived
            ? format(m.statusArchived)
            : fn.latestVersionNo === null
              ? format(m.versionNone)
              : format(m.headerPublished)}
        </span>
      }
      status={
        <>
          <span
            data-testid="formula-save-state"
            data-state={saveState}
            data-release={releaseRelation}
            {...stylex.props(styles.statusGroup, saveState === 'dirty' && styles.statusDirty)}
          >
            {saveState === 'clean' ? <CheckIcon size={12} aria-hidden /> : null}
            {format(
              {
                publishing: m.draftPublishing,
                saving: m.draftSaving,
                dirty: m.draftDirty,
                clean: m.draftClean,
              }[saveState],
            )}
          </span>
          {/* what the saved draft is to the latest publication, said apart
              from whether it is saved at all */}
          {releaseRelation === 'none' ? null : (
            <>
              <span aria-hidden {...stylex.props(styles.statusRule)} />
              <span
                data-testid="formula-release-relation"
                data-release={releaseRelation}
                {...stylex.props(
                  styles.statusGroup,
                  releaseRelation === 'ahead' && styles.statusAhead,
                )}
              >
                {format(releaseRelation === 'same' ? m.draftMatchesRelease : m.draftUnpublished)}
              </span>
            </>
          )}
          {fn.latestVersionNo === null ? null : (
            <>
              <span aria-hidden {...stylex.props(styles.statusRule)} />
              <button
                type="button"
                data-testid="formula-latest-release"
                title={format(m.openRelease)}
                onClick={() => showView({ kind: 'release', versionNo: fn.latestVersionNo! })}
                {...stylex.props(styles.statusGroup, styles.statusLink)}
              >
                <span {...stylex.props(styles.statusClip)}>
                  {format(m.latestReleaseIs, {
                    name: releaseWords({
                      versionNo: fn.latestVersionNo,
                      releaseName: fn.latestReleaseName,
                    }),
                  })}
                </span>
              </button>
            </>
          )}
          {copiedFrom === null ? null : (
            <>
              <span aria-hidden {...stylex.props(styles.statusRule)} />
              <span {...stylex.props(styles.statusGroup)}>
                <span {...stylex.props(styles.statusLabel)}>{format(m.templatesCopiedFrom)}</span>
                <span {...stylex.props(styles.chip, styles.chipStill)}>
                  <span {...stylex.props(styles.chipWords)}>{copiedFrom.functionName}</span>
                  <span {...stylex.props(styles.chipWords, styles.chipQuiet)}>
                    {releaseWords(copiedFrom)}
                  </span>
                </span>
              </span>
            </>
          )}
        </>
      }
      actions={
        <>
          {versionsButton}
          {saveButton}
          {publishButton}
          {menu}
        </>
      }
      phoneActions={versionsButton}
      phoneMenu={menu}
    />
  )

  const notices = (
    <>
      {failure === null ? null : (
        <div role="alert" {...stylex.props(styles.notice, styles.noticeDanger)}>
          {failure}
        </div>
      )}
      {remoteMoved ? (
        <div
          data-testid="formula-remote-moved"
          {...stylex.props(styles.notice, styles.noticeWarning)}
        >
          <span {...stylex.props(styles.noticeWords)}>
            <span {...stylex.props(styles.noticeTitle)}>{format(m.remoteMovedTitle)}</span>
            {format(m.remoteMovedHint)}
          </span>
          <span {...stylex.props(w.spring)} />
          <Button variant="outline" size="xs" onClick={discardLocal}>
            {format(m.discardLocal)}
          </Button>
        </div>
      ) : null}
    </>
  )

  // the edits this browser kept, offered over the source rather than above it
  const keptDraft =
    localDraft === null ? null : (
      <div data-testid="formula-local-draft" {...stylex.props(styles.floating)}>
        <span {...stylex.props(styles.floatingWords)}>
          <span {...stylex.props(styles.noticeTitle)}>{format(m.localDraftTitle)}</span>
          <span {...stylex.props(styles.chipQuiet)}>
            {format(m.localDraftHint, {
              when: shortWhen(new Date(localDraft.keptAt).toISOString(), format, locale),
            })}
          </span>
        </span>
        <span {...stylex.props(styles.floatingActions)}>
          <span {...stylex.props(w.spring)} />
          <Button variant="ghost" size="xs" onClick={dropLocalDraft}>
            {format(m.localDraftDrop)}
          </Button>
          <Button
            variant="outline"
            size="xs"
            data-testid="formula-local-draft-take"
            onClick={takeLocalDraft}
          >
            {format(m.localDraftTake)}
          </Button>
        </span>
      </div>
    )

  // ---- the source -----------------------------------------------------------

  const editor = (
    <Suspense
      fallback={
        <div {...stylex.props(styles.editorLoading)} role="status">
          <Spinner aria-label={format(m.editorLoading)} />
          <span>{format(m.editorLoading)}</span>
        </div>
      }
    >
      <LazyFormulaCodeEditor
        functionId={functionId}
        lease={editorLease}
        value={source}
        onChange={setSource}
        seed={editorSeed}
        readOnly={archived}
        ariaLabel={format(m.sourceLabel)}
      />
    </Suspense>
  )

  /** leaving the page for somebody else's formula, with unsaved work here */
  const browseTemplates = () => {
    const go = () => goto('assessment-formula/templates')
    if (!dirty()) {
      go()
      return
    }
    ask({
      title: format(m.leaveForTemplatesTitle),
      description: format(m.leaveForTemplatesDescription),
      confirmLabel: format(m.leaveForTemplatesConfirm),
      act: go,
    })
  }

  // Nothing written yet, and nothing written before: the source area is the
  // choice of how to begin rather than an empty editor with a card over it.
  const beginning = blank && !started && !archived
  const emptySource = (
    <div data-testid="formula-empty-source" {...stylex.props(styles.emptyFill)}>
      <div {...stylex.props(styles.emptyCard)}>
        <SigmaIcon size={22} aria-hidden {...stylex.props(styles.emptyGlyph)} />
        <p {...stylex.props(styles.emptyTitle)}>{format(m.emptySourceTitle)}</p>
        <p {...stylex.props(styles.emptyHint)}>{format(m.emptySourceHint)}</p>
        <div {...stylex.props(styles.emptyActions)}>
          <Button size="sm" onClick={loadExample}>
            <FileCodeIcon aria-hidden />
            {format(m.loadExample)}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setStarted(true)}>
            {format(m.startBlank)}
          </Button>
          {templatesHref === undefined ? null : (
            <Button size="sm" variant="ghost" onClick={browseTemplates}>
              {format(m.browseTemplates)}
            </Button>
          )}
        </div>
      </div>
    </div>
  )

  /** puts what the compiler said on the clipboard, one finding or all of them */
  const copyWords = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(format(m.copied)))
      .catch(() => toast.error(format(m.copyFailed)))
  }
  const diagnosticWords = (row: { line: number; column: number; code: string; message: string }) =>
    `${String(row.line)}:${String(row.column)} ${row.code} ${row.message}`

  /** takes the caret to a place in the source the compiler named */
  const jumpTo = (line: number, column: number) => {
    setPhoneTab('source')
    void import('./editor-session.ts').then(({ revealInSession }) => {
      revealInSession(draftSessionKey(editorLease), line, column)
    })
  }

  /** a refused parameter has no line, so its name is where to start looking */
  const jumpToWord = (word: string) => {
    setPhoneTab('source')
    void import('./editor-session.ts').then(({ revealWordInSession }) => {
      revealWordInSession(draftSessionKey(editorLease), word)
    })
  }

  const diagnosticsDetail = (
    <>
      {diagnostics.length === 0 ? (
        refusalWords === null || blank ? null : (
          <p {...stylex.props(w.note)}>{refusalWords}</p>
        )
      ) : (
        <table {...stylex.props(w.reportTable)} data-testid="formula-diagnostics">
          <tbody>
            {diagnostics.map((row, index) => (
              // the whole line is the way to the place it names
              <tr
                key={index}
                data-testid="formula-diagnostic"
                title={format(m.jumpToLine)}
                onClick={() => jumpTo(row.line, row.column)}
                {...stylex.props(styles.diagnosticRow)}
              >
                <td {...stylex.props(w.reportCell, w.mono, w.fit, styles.middle)}>
                  {row.line}:{row.column}
                </td>
                <td {...stylex.props(w.reportCell, w.mono, w.fit, styles.middle)}>{row.code}</td>
                <td {...stylex.props(w.reportCell, styles.middle)}>{row.message}</td>
                <td {...stylex.props(w.reportCell, w.fit, styles.middle)}>
                  <button
                    type="button"
                    data-testid="formula-diagnostic-copy"
                    aria-label={format(m.copyValue)}
                    title={format(m.copyValue)}
                    onClick={(event) => {
                      event.stopPropagation()
                      copyWords(diagnosticWords(row))
                    }}
                    {...stylex.props(styles.iconAction)}
                  >
                    <CopyIcon size={13} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {packagerWords === undefined ? null : (
        <p {...stylex.props(styles.rawLine)}>
          <span {...stylex.props(styles.rawWords)}>{packagerWords}</span>
          <button
            type="button"
            data-testid="formula-packager-copy"
            aria-label={format(m.copyTechnicalDetail)}
            title={format(m.copyTechnicalDetail)}
            onClick={() => copyWords(packagerWords)}
            {...stylex.props(styles.iconAction)}
          >
            <CopyIcon size={13} aria-hidden />
          </button>
        </p>
      )}
    </>
  )

  const compileBody = (
    <div
      data-testid="formula-compile-state"
      data-state={compileState}
      {...stylex.props(w.panelScroll)}
    >
      {compileState === 'blank' ? (
        <div {...stylex.props(w.verdictBlock)}>
          <span {...stylex.props(w.verdictQuiet)}>{format(m.compileBlank)}</span>
        </div>
      ) : compileState === 'passed' ? (
        <div {...stylex.props(w.verdictBlock)}>
          <CircleCheckIcon size={30} aria-hidden {...stylex.props(w.verdictGood)} />
          <span {...stylex.props(w.verdictWords)}>{format(m.compileReady)}</span>
        </div>
      ) : compileState === 'working' ? (
        <div role="status" {...stylex.props(w.verdictBlock)}>
          <Spinner aria-hidden xstyle={w.verdictSpinner} />
          <span {...stylex.props(w.verdictQuiet)}>{structureWords}</span>
        </div>
      ) : (
        <>
          <p {...stylex.props(styles.stateLine)}>
            <ToneDot tone="bad" />
            <span {...stylex.props(styles.failTitle)}>{format(m.compileFailed)}</span>
            {diagnostics.length === 0 ? null : (
              <span {...stylex.props(styles.failCount)}>
                {format(m.compileFindings, { count: diagnostics.length })}
              </span>
            )}
          </p>
          {diagnosticsDetail}
        </>
      )}
    </div>
  )

  // A phone shows the code and what the compiler made of it on different
  // tabs, so a strip over the code says how many problems there are and
  // takes the reader to them.
  const compileStrip = (
    <div
      data-testid="formula-compile-strip"
      data-state={compileState}
      {...stylex.props(styles.phoneStrip)}
    >
      <span {...stylex.props(styles.stripBad)}>
        <ToneDot tone="bad" />
        {format(m.compileFindings, { count: diagnostics.length })}
      </span>
      <span {...stylex.props(w.spring)} />
      <button
        type="button"
        data-testid="formula-see-compile"
        onClick={() => setPhoneTab('compile')}
        {...stylex.props(styles.quietAction)}
      >
        {format(m.seeCompile)}
      </button>
    </div>
  )

  // ---- the try-run and the contract -----------------------------------------

  /** a remembered try, put back into the form so it can be asked again */
  const pickRecord = (record: TryRecord) => {
    if (contract === null) return
    const picked = draftsFromStored(contract.inputSchema, record.input)
    setTryDrafts(picked)
    setTryIssues(undefined)
    setTryResult({
      ...record.outcome,
      at: record.at,
      forSource: record.mark === sourceMark(source) ? source : '',
      forCase: JSON.stringify(picked),
    })
    setRecordsOpen(false)
  }

  // a form drawn from a structure the code no longer has says where to read why
  const structureAction =
    structure === 'refused' ? (
      <button
        type="button"
        data-testid="formula-structure-problems"
        onClick={() => {
          setTab('compile')
          setPhoneTab('compile')
        }}
        {...stylex.props(styles.quietAction)}
      >
        {format(m.seeProblems)}
      </button>
    ) : undefined

  const trySection = (phone: boolean) => (
    <TryRunPanel
      title={format(m.tryTitle)}
      narrow={phone}
      status={{
        testId: 'formula-structure',
        state: structure,
        tone:
          structure === 'synced'
            ? 'quiet'
            : structure === 'refused'
              ? 'warn'
              : structure === 'blank'
                ? 'quiet'
                : 'working',
        words: structureWords,
        ...(structureAction === undefined ? {} : { action: structureAction }),
      }}
      schema={contract?.inputSchema ?? null}
      pending={{
        state: structure,
        words: structure === 'blank' ? format(m.tryBlank) : structureWords,
        working: structure !== 'refused' && structure !== 'blank',
        off: structure === 'refused',
      }}
      drafts={tryDrafts}
      onDraft={(field, draft) => setTryDrafts({ ...tryDrafts, [field]: draft })}
      issues={tryIssues}
      disabled={archived}
      running={running}
      result={
        tryResult === null
          ? null
          : {
              outcome: tryResult,
              fresh: !tryStale(tryResult),
              ...(tryResult.at === undefined ? {} : { at: tryResult.at }),
            }
      }
      onRun={() => void runTry()}
      onKeep={(expected) => {
        setExampleSeed({ drafts: tryDrafts, ...(expected === '' ? {} : { expected }) })
        setAddingExample(true)
      }}
      recordCount={tryRecords.records.length}
      onOpenRecords={() => setRecordsOpen(true)}
    />
  )

  const contractBody = (
    <>
      {issues.length === 0 ? null : (
        <div {...stylex.props(styles.issues)}>
          <table {...stylex.props(w.reportTable)} data-testid="formula-contract-issues">
            <thead>
              <tr>
                <th {...stylex.props(w.reportHead, w.fit)}>{format(m.parametersLabel)}</th>
                <th {...stylex.props(w.reportHead)}>{format(m.contractIssueColumn)}</th>
                <th {...stylex.props(w.reportHead, w.fit)} />
              </tr>
            </thead>
            <tbody>
              {issues.map((row, index) => (
                <tr key={index} data-reason={row.reason}>
                  <td {...stylex.props(w.reportCell, w.mono, w.fit, styles.middle)}>
                    {sourceWordOf(row.path) === null ? null : (
                      <button
                        type="button"
                        data-testid="formula-issue-jump"
                        title={format(m.findInSource)}
                        onClick={() => jumpToWord(sourceWordOf(row.path)!)}
                        {...stylex.props(styles.quietAction, styles.monoAction)}
                      >
                        {sourceWordOf(row.path)}
                      </button>
                    )}
                  </td>
                  <td {...stylex.props(w.reportCell, styles.middle)}>
                    {contractReasonWords(format, row.reason)}
                  </td>
                  <td {...stylex.props(w.reportCell, w.fit, styles.middle)}>
                    {contractDetail === undefined || index > 0 ? null : (
                      <button
                        type="button"
                        data-testid="formula-contract-copy"
                        onClick={() => copyWords(contractDetail)}
                        {...stylex.props(styles.quietAction)}
                      >
                        <CopyIcon size={13} aria-hidden />
                        {format(m.copyTechnicalDetail)}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {contract === null ? (
        <p {...stylex.props(w.note)}>{structureWords}</p>
      ) : (
        <>
          {structure === 'synced' ? null : <p {...stylex.props(w.note)}>{structureWords}</p>}
          <ContractTable inputSchema={contract.inputSchema} outputSchema={contract.outputSchema} />
        </>
      )}
    </>
  )

  // ---- the examples ---------------------------------------------------------

  const compileActions =
    diagnostics.length === 0 ? null : (
      <Button
        variant="ghost"
        size="xs"
        data-testid="formula-diagnostics-copy-all"
        onClick={() => copyWords(diagnostics.map(diagnosticWords).join('\n'))}
      >
        <CopyIcon aria-hidden />
        {format(m.copyAll)}
      </Button>
    )

  const examplesActions = (
    <>
      <Button
        variant="outline"
        size="xs"
        disabled={archived || running || blank || tests.length === 0}
        onClick={() => {
          setTab('examples')
          void runRows(tests.map((one) => one.key))
        }}
      >
        <ListChecksIcon aria-hidden />
        {format(running ? m.running : m.runAll)}
      </Button>
      <Button variant="ghost" size="xs" disabled={archived} onClick={addCase}>
        <PlusIcon aria-hidden />
        {format(m.addTest)}
      </Button>
    </>
  )

  const exampleRows = (phone: boolean) =>
    cases.length === 0 ? (
      <div {...stylex.props(w.emptyFill)}>
        <EmptyRow>{format(m.examplesEmpty)}</EmptyRow>
      </div>
    ) : (
      cases.map((one) => (
        <ExampleRow
          key={one.test.key}
          index={one.index}
          name={one.test.name}
          narrow={phone}
          facts={inputFactsOf(format, locale, contract?.inputSchema ?? null, storedInput(one.test))}
          expected={one.test.expected}
          outcome={
            one.outcome === undefined
              ? undefined
              : {
                  ...(one.outcome.passed === undefined ? {} : { passed: one.outcome.passed }),
                  ...(one.outcome.actual === undefined ? {} : { actual: one.outcome.actual }),
                  ...(one.outcome.refusal === undefined ? {} : { refusal: one.outcome.refusal }),
                  ...(one.outcome.defect === undefined ? {} : { defect: one.outcome.defect }),
                  stale: one.stale,
                }
          }
          verdict={one.verdict}
          legal={one.legal}
          open={sheetOpen && editingKey === one.test.key}
          onOpen={() => openCase(one.test.key)}
          locked={archived}
          running={running || blank}
          runningHere={runningKeys.includes(one.test.key)}
          onRun={() => void runRows([one.test.key])}
          onLoadIntoTry={() => loadIntoTry(one.test)}
          onDuplicate={() => setTests([...tests, { ...one.test, key: newTestKey() }])}
          onRemove={() => setTests(tests.filter((kept) => kept.key !== one.test.key))}
        />
      ))
    )

  // the table, whose header row is what tells the six columns apart
  const examplesBody = (
    <>
      <div {...stylex.props(exampleStyles.columns, exampleStyles.head)}>
        <span>{format(m.testName)}</span>
        <span>{format(m.examplesInputColumn)}</span>
        <span {...stylex.props(exampleStyles.end)}>{format(m.examplesExpectedColumn)}</span>
        <span {...stylex.props(exampleStyles.end)}>{format(m.reportActualColumn)}</span>
        <span>{format(m.reportOutcome)}</span>
        <span />
      </div>
      <div {...stylex.props(w.panelScroll)}>{exampleRows(false)}</div>
    </>
  )

  // ---- publishing -----------------------------------------------------------

  const publishChecks: readonly PublishCheck[] = [
    {
      key: 'saved',
      tone: dirty() ? 'quiet' : 'good',
      words: format(dirty() ? m.publishCheckUnsaved : m.draftClean),
    },
    { key: 'examples', tone: examplesTone, words: summary },
    {
      key: 'compile',
      tone: compileTone,
      words:
        compileState === 'failed'
          ? format(m.compileFailed)
          : compileState === 'passed'
            ? format(m.compileReady)
            : structureWords,
    },
    {
      key: 'contract',
      tone: contractTone,
      words:
        issues.length > 0
          ? format(m.contractFailed)
          : structure === 'synced'
            ? format(m.contractReady)
            : structureWords,
    },
  ]

  // The one line at the foot: the first thing standing in the way, in the
  // order a publication would meet it, and the one step that settles it.
  const gate: WorkbenchGate =
    compileState === 'blank' || compileState === 'failed' || compileState === 'working'
      ? {
          label: format(m.panelLabel),
          testId: 'formula-gate',
          tone: compileTone,
          words:
            compileState === 'failed'
              ? diagnostics.length === 0
                ? format(m.compileFailed)
                : format(m.compileFailedCount, { count: diagnostics.length })
              : compileState === 'blank'
                ? format(m.compileBlank)
                : structureWords,
          ...(compileState === 'failed'
            ? {
                action: (
                  <button
                    type="button"
                    data-testid="formula-gate-action"
                    onClick={() => {
                      setTab('compile')
                      setPhoneTab('compile')
                    }}
                    {...stylex.props(styles.quietAction)}
                  >
                    {format(m.seeProblems)}
                  </button>
                ),
              }
            : {}),
        }
      : issues.length > 0
        ? {
            label: format(m.panelLabel),
            testId: 'formula-gate',
            tone: 'bad',
            words: format(m.contractFailed),
            action: (
              <button
                type="button"
                data-testid="formula-gate-action"
                onClick={() => {
                  setTab('contract')
                  setPhoneTab('contract')
                }}
                {...stylex.props(styles.quietAction)}
              >
                {format(m.seeProblems)}
              </button>
            ),
          }
        : {
            label: format(m.panelLabel),
            testId: 'formula-gate',
            tone: examplesTone,
            words: summary,
            ...(adoptable !== null && !archived
              ? {
                  action: (
                    <button
                      type="button"
                      data-testid="formula-gate-action"
                      onClick={() => editCase(adoptable.key, { expected: adoptable.actual })}
                      {...stylex.props(styles.quietAction)}
                    >
                      {format(m.adoptActual, { value: adoptable.actual })}
                    </button>
                  ),
                }
              : notRun > 0 && !archived && !blank
                ? {
                    // nothing here runs by itself: a run costs a sandbox, and
                    // "not run yet" is a true thing to say. The one press that
                    // settles it stands where the answer is wanted.
                    action: (
                      <button
                        type="button"
                        data-testid="formula-gate-action"
                        disabled={running}
                        onClick={() => {
                          setTab('examples')
                          setPhoneTab('examples')
                          void runRows(tests.map((one) => one.key))
                        }}
                        {...stylex.props(styles.quietAction)}
                      >
                        {format(running ? m.running : m.runAll)}
                      </button>
                    ),
                  }
                : cases.length > 0
                  ? {
                      action: (
                        <button
                          type="button"
                          data-testid="formula-gate-action"
                          onClick={() => {
                            setTab('examples')
                            setPhoneTab('examples')
                          }}
                          {...stylex.props(styles.quietAction)}
                        >
                          {format(m.goExamples)}
                        </button>
                      ),
                    }
                  : {}),
          }

  return (
    <WorkbenchLayout
      narrow={narrow}
      testId="formula-editor"
      status={fn.status}
      {...(motion === 'back' ? { motion: 'back' as const } : {})}
      bar={bar}
      notices={notices}
      source={
        beginning ? (
          emptySource
        ) : (
          <>
            {editor}
            {keptDraft}
          </>
        )
      }
      tryRun={trySection(false)}
      tryLabel={format(m.tryTitle)}
      panelTabs={[
        {
          value: 'examples',
          label: format(m.testsTitle),
          tone: examplesTone,
          count: tests.length,
          content: examplesBody,
        },
        {
          value: 'compile',
          label: format(m.diagnosticsTitle),
          tone: compileTone,
          ...(diagnostics.length === 0 ? {} : { count: diagnostics.length }),
          content: compileBody,
        },
        {
          value: 'contract',
          label: format(m.contractIssuesTitle),
          tone: contractTone,
          ...(issues.length === 0 ? {} : { count: issues.length }),
          content: <div {...stylex.props(w.panelScroll)}>{contractBody}</div>,
        },
      ]}
      panelTab={tab}
      onPanelTab={(next) => setTab(next as PanelTab)}
      panelActions={
        tab === 'compile' ? compileActions : tab === 'examples' ? examplesActions : null
      }
      panelLabel={format(m.checksTitle)}
      phoneTabs={[
        {
          value: 'source',
          label: format(m.phoneSourceTab),
          content: (
            <div {...stylex.props(styles.phoneSource)}>
              {beginning ? null : compileState === 'failed' ? compileStrip : null}
              <div {...stylex.props(styles.phoneEditor)}>
                {beginning ? (
                  emptySource
                ) : (
                  <>
                    {editor}
                    {keptDraft}
                  </>
                )}
              </div>
            </div>
          ),
        },
        { value: 'try', label: format(m.tryTitle), content: trySection(true) },
        {
          value: 'examples',
          label: format(m.testsTitle),
          tone: examplesTone,
          count: tests.length,
          content: (
            <div {...stylex.props(styles.phoneExamples)}>
              <div {...stylex.props(styles.phoneStrip)}>
                <span>{format(m.examplesCount, { count: cases.length })}</span>
                <span {...stylex.props(w.spring)} />
                {examplesActions}
              </div>
              <div {...stylex.props(w.panelScroll)}>{exampleRows(true)}</div>
            </div>
          ),
        },
        {
          value: 'compile',
          label: format(m.diagnosticsTitle),
          tone: compileTone,
          ...(diagnostics.length === 0 ? {} : { count: diagnostics.length }),
          content: compileBody,
        },
        {
          value: 'contract',
          label: format(m.contractIssuesTitle),
          tone: contractTone,
          ...(issues.length === 0 ? {} : { count: issues.length }),
          content: <div {...stylex.props(w.panelScroll)}>{contractBody}</div>,
        },
      ]}
      phoneTab={phoneTab}
      onPhoneTab={setPhoneTab}
      gate={gate}
      foot={
        <>
          {saveButton}
          {publishButton}
        </>
      }
    >
      <Sheet
        open={sheetOpen && editingCase !== undefined}
        onOpenChange={(open) => {
          if (!open) setSheetOpen(false)
        }}
      >
        <SheetContent side={narrow ? 'bottom' : 'right'} xstyle={styles.caseSheet}>
          <SheetHeader>
            <SheetTitle>{format(m.exampleEditTitle)}</SheetTitle>
            <SheetDescription>{format(m.exampleEditHint)}</SheetDescription>
          </SheetHeader>
          {editingCase === undefined ? null : (
            <div
              data-testid="formula-case-editor"
              data-legal={editingCase.legal}
              {...stylex.props(styles.caseBody)}
            >
              {caseFields(editingCase.test, editingCase.legal)}
              {/* what the last run made of it, in the same place every time */}
              <p
                data-testid="formula-case-verdict"
                data-verdict={editingCase.verdict}
                aria-live="polite"
                {...stylex.props(
                  styles.caseVerdict,
                  editingCase.verdict === 'passed' && styles.caseVerdictGood,
                  editingCase.verdict === 'failed' && styles.caseVerdictBad,
                )}
              >
                {editingCase.verdict === 'passed' ? (
                  <CircleCheckIcon size={15} aria-hidden />
                ) : editingCase.verdict === 'failed' ? (
                  <CircleXIcon size={15} aria-hidden />
                ) : (
                  <ToneDot tone="quiet" />
                )}
                <span {...stylex.props(styles.caseVerdictWords)}>
                  {editingCase.outcome === undefined || editingCase.stale
                    ? format(editingCase.outcome === undefined ? m.conclusionNotRun : m.resultStale)
                    : (outcomeWords(format, editingCase.outcome) ??
                      (editingCase.outcome.actual === undefined
                        ? format(m.resultPassed)
                        : format(m.resultActual, { value: editingCase.outcome.actual })))}
                </span>
              </p>
            </div>
          )}
          {editingCase === undefined ? null : (
            <SheetFooter xstyle={styles.caseFoot}>
              <Button
                variant="outline"
                size="sm"
                disabled={archived || running || blank}
                onClick={() => void runRows([editingCase.test.key])}
              >
                <PlayIcon aria-hidden />
                {format(running ? m.running : m.run)}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={archived}
                onClick={() => loadIntoTry(editingCase.test)}
              >
                {format(m.loadIntoTry)}
              </Button>
              <span {...stylex.props(w.spring)} />
              <Button
                variant="ghost"
                size="sm"
                disabled={archived}
                onClick={() => {
                  setSheetOpen(false)
                  setTests(tests.filter((one) => one.key !== editingCase.test.key))
                }}
              >
                {format(m.removeTest)}
              </Button>
              <Button size="sm" onClick={() => setSheetOpen(false)}>
                {format(m.exampleDone)}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
      <NewExampleDialog
        open={addingExample}
        contract={contract}
        initial={exampleSeed}
        expectedProblem={(expected) =>
          expectedIssueOf({ key: '', name: '', inputText: '{}', expected }, contract)
        }
        onClose={() => setAddingExample(false)}
        onAdd={(example) => {
          setTests([...tests, { key: newTestKey(), ...example }])
          setAddingExample(false)
          setTab('examples')
        }}
      />
      <PublishDialog
        open={publishOpen}
        dirty={dirty()}
        checks={publishChecks}
        pending={publish.isPending}
        failure={publishFailure}
        nameProblem={nameProblem}
        onClose={() => setPublishOpen(false)}
        onPublish={(release) => publish.mutate(release)}
      />
      {versionsDrawer}
      {sharingDialog}
      <TryRecordsDrawer
        open={recordsOpen}
        onOpenChange={setRecordsOpen}
        narrow={narrow}
        records={tryRecords.records}
        schema={contract?.inputSchema ?? null}
        mark={sourceMark(source)}
        onPick={pickRecord}
        onClear={tryRecords.clear}
      />
      {confirmDialog}
    </WorkbenchLayout>
  )
}
