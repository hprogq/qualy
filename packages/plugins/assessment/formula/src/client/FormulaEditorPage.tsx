import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  PageLink,
  useApi,
  useApiQuery,
  usePageRouteParams,
  useClaimScreenFill,
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
import { Field } from '@qualy/ui/admin'
import { Spinner } from '@qualy/ui/spinner'
import { Skeleton } from '@qualy/ui/skeleton'
import { EmptyRow } from '@qualy/ui/empty-row'
import { PageContainer } from '@qualy/ui/page-container'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@qualy/ui/sheet'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  CircleCheckIcon,
  EqualIcon,
  ListChecksIcon,
  ListPlusIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  UploadIcon,
} from 'lucide-react'
import { constraintOf, parameterSchemaAt, type AtomicSchema } from '@qualy/value-schema'
import { validateValue } from '@qualy/value-schema/validate'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { useDraftPreview, type DraftContract } from './use-draft-preview.ts'
import { VersionSharing } from './VersionSharing.tsx'
import { ContractTable } from './ContractTable.tsx'
import { kindWords } from './kind-words.ts'
import { ExampleRow, type Verdict } from './ExampleRow.tsx'
import { exampleStyles } from './example-grid.ts'
import { shortWhen } from './library-styles.ts'
import { AtomicValueField, InputValueForm } from '@qualy/web-value-form/InputValueForm'
import {
  draftsFromStored,
  materializeField,
  materializeInput,
  type FieldDraft,
} from '@qualy/web-value-form/model'

// Monaco rides its own chunk: the list page, the app shell and even this
// page's first paint stay free of it - the editor arrives when the source
// panel does
const FormulaCodeEditor = lazy(() => import('./FormulaCodeEditor.tsx'))

// One formula, laid out like the tool it is: write on the left, try on the
// right, and under both a panel that says whether it can be published - its
// examples, what the compiler made of it, and the structure it takes.
//
// The screen fills the height the application's bars leave, so the source,
// the try-run and the examples each scroll in their own place and none of
// them pushes the others off the screen. The bar across the top holds the
// formula's name, where its draft stands, and the three things that happen
// to the whole of it: archive, save, publish. On a phone the parts stack
// and the page scrolls as one.

/** the view the panel under the editor shows */
type PanelTab = 'examples' | 'compile' | 'contract'

/** how a panel view stands, for the dot on its tab */
type Tone = 'good' | 'bad' | 'quiet'

const MONO = 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace'

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
    gap: { default: 12, [breakpoints.phone]: 8 },
    minHeight: 56,
    paddingBlock: 8,
    paddingInline: { default: 20, [breakpoints.phone]: layout.pageGutter },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
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
  backWords: { display: { default: null, [breakpoints.phone]: 'none' } },
  rule: {
    width: 1,
    height: 16,
    flexShrink: 0,
    backgroundColor: tokens.border,
    display: { default: null, [breakpoints.phone]: 'none' },
  },
  heading: {
    display: 'flex',
    minWidth: 0,
    flexGrow: { default: 0, [breakpoints.phone]: 1 },
    flexShrink: 1,
    flexDirection: 'column',
    gap: 2,
  },
  titleLine: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  // the name edits in place, as a title rather than as a form field: it is
  // a field only to the pointer resting on it and the caret inside it
  name: {
    minWidth: { default: '6em', [breakpoints.phone]: 0 },
    flexShrink: 1,
    maxWidth: { default: '24rem', [breakpoints.phone]: '100%' },
    height: 28,
    marginLeft: -6,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: 6,
    outline: 'none',
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 15,
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
  standing: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 20,
    paddingInline: 7,
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  standingPublished: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 15%, transparent)`,
    color: tokens.successForeground,
  },
  standingDraft: { backgroundColor: tokens.surfaceMuted, color: tokens.mutedForeground },
  standingArchived: {
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    color: tokens.mutedForeground,
  },
  statusLine: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    columnGap: 12,
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  statusDirty: { color: tokens.warningForeground },
  spring: { flexGrow: 1 },
  springWide: { flexGrow: 1, display: { default: null, [breakpoints.phone]: 'none' } },
  actions: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: { default: 8, [breakpoints.phone]: 4 },
  },
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
  noticeDanger: { backgroundColor: tokens.dangerSurface, color: tokens.danger },
  noticeWarning: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 12%, ${tokens.surface})`,
    color: tokens.foreground,
  },
  noticeWords: { minWidth: 0 },
  noticeTitle: { fontWeight: 600, marginRight: 8 },

  upper: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
    flexDirection: { default: 'row', [breakpoints.phone]: 'column' },
  },
  sourcePane: {
    display: 'flex',
    minWidth: 0,
    // a definite height on a phone, where the page scrolls as one: the editor
    // inside fills its pane by percentage, which a minimum does not resolve
    minHeight: 0,
    height: { default: null, [breakpoints.phone]: '26rem' },
    flexGrow: { default: 1, [breakpoints.phone]: 0 },
    flexDirection: 'column',
    backgroundColor: tokens.surface,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderWidth: 0,
    borderRightWidth: { default: 1, [breakpoints.phone]: 0 },
    borderBottomWidth: { default: 0, [breakpoints.phone]: 1 },
  },
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
  // The try-run holds still and the versions scroll under it: a version list
  // grows with every publication, and it must never carry the form the
  // author is typing into out of reach.
  side: {
    display: 'flex',
    width: { default: 324, [breakpoints.tablet]: 288, [breakpoints.phone]: 'auto' },
    minHeight: 0,
    flexShrink: 0,
    flexDirection: 'column',
    overflow: { default: 'hidden', [breakpoints.phone]: 'visible' },
    backgroundColor: tokens.background,
  },
  // a form of many parameters still leaves the versions some room
  tryPart: {
    flexShrink: 0,
    maxHeight: { default: '62%', [breakpoints.phone]: null },
    overflowY: { default: 'auto', [breakpoints.phone]: 'visible' },
  },
  versionsPart: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexDirection: 'column',
  },
  versionsScroll: {
    minHeight: 0,
    flexGrow: 1,
    overflowY: { default: 'auto', [breakpoints.phone]: 'visible' },
  },
  sideHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    paddingTop: 14,
    paddingBottom: 8,
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
  sideNoteOff: { color: tokens.warningForeground },
  sideEmpty: {
    margin: 0,
    paddingInline: 16,
    paddingBottom: 14,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  sideRule: { height: 1, flexShrink: 0, backgroundColor: tokens.border },
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
  versions: { margin: 0, padding: 0, paddingBottom: 8, listStyle: 'none' },
  version: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginInline: 16,
    paddingBlock: 10,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  versionHead: { display: 'flex', alignItems: 'center', gap: 10 },
  versionNo: { fontSize: 13, fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  versionNoLatest: { fontWeight: 600, color: tokens.foreground },
  versionWhen: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },

  panel: {
    display: 'flex',
    height: { default: 268, [breakpoints.phone]: 'auto' },
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
    flexWrap: { default: 'nowrap', [breakpoints.phone]: 'wrap' },
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  tabList: { gap: 0 },
  tab: {
    height: 38,
    gap: 7,
    paddingInline: 14,
    borderRadius: 0,
    fontSize: 12.5,
  },
  // the tab wraps what it is given in a label of its own, so the spacing
  // between the dot, the name and the count has to be inside
  tabWords: { display: 'inline-flex', alignItems: 'center', gap: 7 },
  tabCount: {
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
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
  panelBody: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  panelScroll: { minHeight: 0, flexGrow: 1, overflowY: 'auto' },
  panelFoot: {
    display: 'flex',
    minHeight: 36,
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  footRule: { width: 1, height: 12, backgroundColor: tokens.border },
  footTotal: { fontVariantNumeric: 'tabular-nums' },
  footAction: {
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
  stateLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: 0,
    paddingBlock: 12,
    paddingInline: 16,
    fontSize: 13,
  },
  reportTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  reportCell: {
    paddingBlock: 7,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    verticalAlign: 'top',
  },
  // a column as wide as what it holds, leaving the rest to the message
  fit: { width: '1%' },
  mono: { fontFamily: MONO, fontSize: 11.5, whiteSpace: 'nowrap' },
  detail: {
    margin: 0,
    paddingBlock: 10,
    paddingInline: 16,
    whiteSpace: 'pre-wrap',
    fontFamily: MONO,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  issues: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  contractNote: {
    margin: 0,
    paddingBlock: 8,
    paddingInline: 16,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  // the panel's one line when there is nothing to list, in the middle of it
  emptyFill: {
    display: 'flex',
    minHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  caseFields: { display: 'flex', flexDirection: 'column', gap: 14 },
  caseFoot: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 },
  // a verdict the compile view states in one mark, where there is nothing
  // to list
  verdictBlock: {
    display: 'flex',
    minHeight: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingBlock: 16,
  },
  verdictGood: { color: tokens.success },
  verdictWords: { fontSize: 13, fontWeight: 500, color: tokens.foreground },
  verdictQuiet: { fontSize: 12, color: tokens.mutedForeground },
  verdictSpinner: { width: 20, height: 20 },
  failTitle: { fontWeight: 500, color: tokens.danger },
  failCount: { fontSize: 12, color: tokens.mutedForeground },
  problemLine: { margin: 0, fontSize: 12, color: tokens.danger },
  notes: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  skeleton: { display: 'flex', flexDirection: 'column', gap: 16, padding: 20 },
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
 * A case's input in brief, for a table line: the parameters and their
 * values as the author would write them, without the quotes JSON puts on
 * every key. Anything that is not an object of values is shown as stored.
 */
const inputSummaryOf = (inputText: string): string => {
  try {
    const value = JSON.parse(inputText === '' ? '{}' : inputText) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return inputText
    const pairs = Object.entries(value).map(
      ([key, one]) => `${key}: ${typeof one === 'string' ? one : JSON.stringify(one)}`,
    )
    return pairs.length === 0 ? '{}' : `{ ${pairs.join(', ')} }`
  } catch {
    return inputText
  }
}

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

type ReportRow = NonNullable<PublishFindings['report']>[number]
type ReportProblem = NonNullable<ReportRow['problems']>[number]

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

/** the dot a tab carries */
function ToneDot({ tone }: { readonly tone: Tone }) {
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
  const versions = detail.data?.versions ?? []
  // Where this draft was started from, when it was started from somebody
  // else's. A note about how it came to exist and nothing more: there is
  // no following the source, and no version of it to be behind.
  const copiedFrom = detail.data?.copiedFrom ?? null
  // the shell repeats the formula's name once the bar has scrolled away
  const titleRef = usePageTitle(fn?.name ?? format(m.listTitle))
  // a workbench wherever the parts sit side by side: it takes the room under
  // the application's bars and scrolls inside; on a phone the parts stack and
  // the page scrolls as one, so there is nothing to claim
  const narrow = useIsMobile()
  useClaimScreenFill(!narrow)

  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [tests, setTests] = useState<DraftTest[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [findings, setFindings] = useState<PublishFindings>({})

  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  const [remoteMoved, setRemoteMoved] = useState(false)
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
  const preview = useDraftPreview(fn === undefined ? null : source, fetchPreview, formatError)
  // screens render from the last contract that compiled; running and saving
  // tests take their authority from preview.current alone
  const contract = preview.lastGood?.contract ?? null

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
  }
  const [runResults, setRunResults] = useState<Record<string, RunOutcome>>({})
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

  const fieldIssueText = (schema: AtomicSchema | undefined, reason: string): string => {
    switch (reason) {
      case 'required':
        return format(m.fieldRequired)
      case 'not-an-integer':
        return format(m.fieldNotInteger)
      case 'not-a-decimal':
        return format(m.fieldNotDecimal)
      default: {
        const constraint = schema === undefined ? undefined : constraintOf(schema, reason)
        return reasonText({
          at: 'input',
          reason,
          ...(constraint === undefined ? {} : { constraint }),
        })
      }
    }
  }

  const translateIssues = (
    schema: DraftContract['inputSchema'],
    issues: ReadonlyMap<string, string>,
  ): ReadonlyMap<string, string> =>
    new Map(
      [...issues].map(([field, reason]) => [
        field,
        fieldIssueText(field === '' ? undefined : parameterSchemaAt(schema, `/${field}`), reason),
      ]),
    )

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
    if (fresh.status !== 'ready') return null
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
      setTryResult({
        ...answers[0]!,
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

  // the editor follows the server draft ONLY while it holds nothing of its
  // own: a refetch that arrives over unsaved edits (another admin saved)
  // must not overwrite them - it raises the banner and leaves the text alone
  useEffect(() => {
    if (fn === undefined) return
    const holdsEdits =
      baseRevision !== null &&
      (name.trim() !== fn.name ||
        source !== fn.draftSourceTs ||
        JSON.stringify(bareTests(tests)) !== JSON.stringify(bareTests(seededTests(fn))))
    if (baseRevision !== null && fn.draftRevision !== baseRevision && holdsEdits) {
      setRemoteMoved(true)
      return
    }
    setName(fn.name)
    setSource(fn.draftSourceTs)
    setTests(seededTests(fn))
    setBaseRevision(fn.draftRevision)
    setRemoteMoved(false)
    setEditorSeed((seed) => seed + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn?.id, fn?.draftRevision])

  const discardLocal = () => {
    if (fn === undefined) return
    setName(fn.name)
    setSource(fn.draftSourceTs)
    setTests(seededTests(fn))
    setBaseRevision(fn.draftRevision)
    setRemoteMoved(false)
    setEditorSeed((seed) => seed + 1)
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
    onSuccess: async () => {
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
    // saved first - otherwise the button quietly proves yesterday's bytes
    mutationFn: async () => {
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
      }
      return run(
        api.assessmentFormula.publishFormulaVersion({
          params: { functionId },
          payload: { expectedDraftRevision: revision },
        }),
      )
    },
    onMutate: () => {
      setFailure(null)
      setFindings({})
    },
    onSuccess: async (result: { version: { versionNo: number } }) => {
      toast.success(format(m.published, { number: result.version.versionNo }))
      await refresh()
    },
    onError: async (error: unknown) => {
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
      if ((carried.diagnostics?.length ?? 0) > 0) setTab('compile')
      else if ((carried.issues?.length ?? 0) > 0) setTab('contract')
      else if ((carried.report?.length ?? 0) > 0) setTab('examples')
      // the auto-save may have landed even though publishing was refused;
      // without a refresh the editor still holds the old revision and the
      // next save would conflict with its own work
      await refresh()
    },
  })

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      run(
        api.assessmentFormula.setFormulaFunctionStatus({
          params: { functionId },
          payload: { status },
        }),
      ),
    onSuccess: () => refresh(),
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  const reasonText = (problem: ReportProblem): string => {
    const constraint = problem.constraint ?? ''
    switch (problem.reason) {
      case 'x-qualy-maximum':
      case 'maximum':
        return format(m.reasonOverMax, { constraint })
      case 'x-qualy-minimum':
      case 'minimum':
        return format(m.reasonUnderMin, { constraint })
      case 'x-qualy-maxScale':
        return format(m.reasonScale, { constraint })
      case 'maxLength':
        return format(m.reasonTooLong, { constraint })
      case 'minLength':
        return format(m.reasonTooShort, { constraint })
      case 'enum':
        return format(m.reasonEnum, { constraint })
      case 'type':
      case 'format':
        return format(m.reasonKind, { kind: kindWords(format, problem.constraint) })
      case 'pattern':
        return format(m.reasonPattern, { constraint })
      case 'required':
        return format(m.reasonMissing)
      case 'additionalProperties':
        return format(m.reasonExtra)
      default:
        return format(m.reasonOther, { reason: problem.reason })
    }
  }

  // the contract table speaks the author's language, not the validator's:
  // every reason a publish can realistically raise here gets its own words,
  // and the most common one - an unbounded output - says exactly what to type
  const contractReasonText = (reason: string): string => {
    switch (reason) {
      case 'not-a-score-amount':
        return format(m.contractNotScoreAmount)
      case 'not-a-decimal':
        return format(m.contractNotDecimal)
      case 'contract-too-large':
        return format(m.contractTooLarge)
      case 'contract-error':
        return format(m.contractError)
      case 'pattern-invalid':
        return format(m.contractPatternInvalid)
      case 'pattern-too-large':
        return format(m.contractPatternTooLarge)
      case 'pattern-too-complex':
        return format(m.contractPatternTooComplex)
      default:
        return format(m.reasonOther, { reason })
    }
  }

  /** what a finished run says beyond its verdict, or nothing */
  const outcomeNotes = (outcome: RunOutcome): string | null => {
    const problems = Array.isArray(outcome.problems) ? (outcome.problems as ReportProblem[]) : []
    if (problems.length > 0)
      return problems
        .map((problem) =>
          problem.at === 'input'
            ? format(m.problemInput, {
                parameter: problem.parameter ?? '',
                detail: reasonText(problem),
              })
            : problem.at === 'output'
              ? format(m.problemOutput, { detail: reasonText(problem) })
              : format(m.problemExpected, { detail: reasonText(problem) }),
        )
        .join('; ')
    if (outcome.refusal !== undefined) return format(m.refusalPrefix, { message: outcome.refusal })
    if (outcome.defect !== undefined) return format(m.defectPrefix, { message: outcome.defect })
    if (outcome.passed === false) return format(m.resultFailed, { actual: outcome.actual ?? '—' })
    return null
  }

  if (detail.isError) {
    return (
      <PageContainer>
        <EmptyRow role="alert">{format(m.loadFailed)}</EmptyRow>
      </PageContainer>
    )
  }
  if (fn === undefined) {
    return (
      <div {...stylex.props(styles.workbench)} aria-busy>
        <div {...stylex.props(styles.bar)}>
          <Skeleton height={16} width={220} radius={4} />
        </div>
        <div {...stylex.props(styles.skeleton)}>
          <Skeleton height={14} width="40%" radius={4} />
          <Skeleton height={14} width="60%" radius={4} />
          <Skeleton height={14} width="30%" radius={4} />
        </div>
      </div>
    )
  }

  const archived = fn.status === 'archived'
  const busy = save.isPending || publish.isPending

  // the draft contract, as the side panel and the tabs speak of it
  const structure: 'synced' | 'refused' | 'loading' | 'stale' =
    preview.current.status === 'ready' && preview.current.source === source
      ? 'synced'
      : preview.current.status === 'refused' && preview.current.source === source
        ? 'refused'
        : contract === null
          ? 'loading'
          : 'stale'
  const structureWords = format(
    {
      synced: m.structureSynced,
      // a form drawn from the last structure that compiled says so
      refused: contract === null ? m.structureRefused : m.structureKept,
      loading: m.structureLoading,
      stale: m.structureStale,
    }[structure],
  )
  const refusalWords = preview.current.status === 'refused' ? preview.current.refusal : null

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
  const compileState: 'passed' | 'failed' | 'working' =
    diagnostics.length > 0 || (structure === 'refused' && !contractRefused)
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
      label: test.name === '' ? `#${index + 1}` : test.name,
    }
  })
  const examplesTone: Tone = cases.some((one) => one.verdict === 'failed' || one.verdict === 'fix')
    ? 'bad'
    : cases.length > 0 && cases.every((one) => one.verdict === 'passed')
      ? 'good'
      : 'quiet'
  const compileTone: Tone =
    compileState === 'failed' ? 'bad' : compileState === 'passed' ? 'good' : 'quiet'
  const contractTone: Tone = issues.length > 0 ? 'bad' : structure === 'synced' ? 'good' : 'quiet'

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

  const saveState = publish.isPending
    ? 'publishing'
    : save.isPending
      ? 'saving'
      : dirty()
        ? 'dirty'
        : 'clean'

  const tryFresh = tryResult !== null && !tryStale(tryResult)
  const tryActual = tryFresh ? tryResult.actual : undefined

  const addCase = () => {
    const key = newTestKey()
    setTests([...tests, { key, name: '', inputText: '{}', expected: '' }])
    openCase(key)
    setTab('examples')
  }

  const editCase = (key: string, change: Partial<Omit<DraftTest, 'key'>>) =>
    setTests(tests.map((one) => (one.key === key ? { ...one, ...change } : one)))

  const caseFields = (test: DraftTest, legal: boolean, notes: string | null) => {
    const expectedProblem = expectedIssueOf(test, contract)
    return (
      <>
        <div {...stylex.props(styles.caseFields)}>
          <Field label={format(m.testName)}>
            {(id) => (
              <Input
                id={id}
                value={test.name}
                disabled={archived}
                onChange={(event) => editCase(test.key, { name: event.target.value })}
              />
            )}
          </Field>
          {contract === null ? (
            <Field label={format(m.testInput)}>
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
            />
          )}
          {contract === null ? (
            <Field label={format(m.testExpected)}>
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
          )}
        </div>
        {legal ? null : (
          <p {...stylex.props(styles.problemLine)} role="alert">
            {format(m.testRowInvalid)}
          </p>
        )}
        {notes === null ? null : <p {...stylex.props(styles.notes)}>{notes}</p>}
      </>
    )
  }

  const sortedVersions = [...versions].sort((a, b) => b.versionNo - a.versionNo)
  const editingCase = cases.find((one) => one.test.key === editingKey)

  return (
    <div {...stylex.props(styles.workbench)} data-testid="formula-editor" data-status={fn.status}>
      <header {...stylex.props(styles.bar)}>
        <PageLink page="assessment-formula/list" className={stylex.props(styles.back).className}>
          <ArrowLeftIcon size={15} aria-hidden />
          <span {...stylex.props(styles.backWords)}>{format(m.listTitle)}</span>
        </PageLink>
        <span aria-hidden {...stylex.props(styles.rule)} />
        <div ref={titleRef} {...stylex.props(styles.heading)}>
          <div {...stylex.props(styles.titleLine)}>
            <input
              aria-label={format(m.nameLabel)}
              value={name}
              disabled={archived}
              spellCheck={false}
              onChange={(event) => setName(event.target.value)}
              style={{ width: nameWidth(name) }}
              {...stylex.props(styles.name)}
            />
            <span
              data-testid="formula-standing"
              {...stylex.props(
                styles.standing,
                archived
                  ? styles.standingArchived
                  : fn.latestVersionNo === null
                    ? styles.standingDraft
                    : styles.standingPublished,
              )}
            >
              {archived
                ? format(m.statusArchived)
                : fn.latestVersionNo === null
                  ? format(m.versionNone)
                  : format(m.headerPublished, { number: fn.latestVersionNo })}
            </span>
          </div>
          <div {...stylex.props(styles.statusLine)}>
            <span
              data-testid="formula-save-state"
              data-state={saveState}
              {...stylex.props(saveState === 'dirty' && styles.statusDirty)}
            >
              {format(
                {
                  publishing: m.draftPublishing,
                  saving: m.draftSaving,
                  dirty: m.draftDirty,
                  clean: m.draftClean,
                }[saveState],
              )}
            </span>
            {copiedFrom === null ? null : (
              <span>{format(m.templatesCopiedFrom, { number: copiedFrom.versionNo })}</span>
            )}
          </div>
        </div>
        <span {...stylex.props(styles.springWide)} />
        <div {...stylex.props(styles.actions)}>
          <Button
            variant="ghost"
            size={narrow ? 'icon-sm' : 'sm'}
            disabled={setStatus.isPending}
            aria-label={narrow ? format(archived ? m.restore : m.archive) : undefined}
            onClick={() => setStatus.mutate(archived ? 'active' : 'archived')}
          >
            {archived ? <ArchiveRestoreIcon aria-hidden /> : <ArchiveIcon aria-hidden />}
            {narrow ? null : format(archived ? m.restore : m.archive)}
          </Button>
          <Button
            variant="outline"
            size={narrow ? 'icon-sm' : 'sm'}
            disabled={archived || busy || !dirty()}
            aria-label={narrow ? format(m.save) : undefined}
            onClick={saveDraft}
          >
            <SaveIcon aria-hidden />
            {narrow ? null : format(m.save)}
          </Button>
          <Button
            size={narrow ? 'icon-sm' : 'sm'}
            disabled={archived || busy}
            aria-label={narrow ? format(m.publish) : undefined}
            onClick={() => publish.mutate()}
          >
            <UploadIcon aria-hidden />
            {narrow ? null : format(m.publish)}
          </Button>
        </div>
      </header>

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
          <span {...stylex.props(styles.spring)} />
          <Button variant="outline" size="xs" onClick={discardLocal}>
            {format(m.discardLocal)}
          </Button>
        </div>
      ) : null}

      <div {...stylex.props(styles.upper)}>
        <div {...stylex.props(styles.sourcePane)}>
          <Suspense
            fallback={
              <div {...stylex.props(styles.editorLoading)} role="status">
                <Spinner aria-label={format(m.editorLoading)} />
                <span>{format(m.editorLoading)}</span>
              </div>
            }
          >
            <FormulaCodeEditor
              functionId={functionId}
              value={source}
              onChange={setSource}
              seed={editorSeed}
              readOnly={archived}
              ariaLabel={format(m.sourceLabel)}
            />
          </Suspense>
        </div>

        <aside {...stylex.props(styles.side)}>
          <section {...stylex.props(styles.tryPart)}>
            <div {...stylex.props(styles.sideHead)}>
              <h2 {...stylex.props(styles.sideTitle)}>{format(m.tryTitle)}</h2>
              <span {...stylex.props(styles.spring)} />
              <span
                data-testid="formula-structure"
                data-state={structure}
                {...stylex.props(styles.sideNote, structure === 'refused' && styles.sideNoteOff)}
              >
                {/* with no form yet, the room below says it instead */}
                {contract === null ? null : structureWords}
              </span>
            </div>
            {contract === null ? (
              // the form's room, kept while the structure is read: a column
              // that collapsed and then sprang open pushed the versions about
              <div
                role="status"
                data-testid="formula-try-pending"
                data-state={structure}
                {...stylex.props(
                  styles.tryPending,
                  structure === 'refused' && styles.tryPendingOff,
                )}
              >
                {structure === 'refused' ? null : (
                  <Spinner aria-hidden xstyle={styles.tryPendingSpinner} />
                )}
                <span>{structureWords}</span>
              </div>
            ) : (
              <>
                <div {...stylex.props(styles.tryForm)}>
                  <InputValueForm
                    schema={contract.inputSchema}
                    drafts={tryDrafts}
                    onDraft={(name_, draft) => setTryDrafts({ ...tryDrafts, [name_]: draft })}
                    locale={locale}
                    disabled={archived || running}
                    problems={tryIssues}
                    scope="try"
                  />
                </div>
                <div {...stylex.props(styles.tryActions)}>
                  <Button size="sm" disabled={archived || running} onClick={() => void runTry()}>
                    <PlayIcon aria-hidden />
                    {format(running ? m.running : m.run)}
                  </Button>
                  {tryActual === undefined ? null : (
                    <span data-testid="formula-try-result" {...stylex.props(styles.tryInline)}>
                      <span {...stylex.props(styles.tryInlineLabel)}>{format(m.resultLabel)}</span>
                      <span {...stylex.props(styles.tryInlineValue)}>{tryActual}</span>
                    </span>
                  )}
                </div>
                {tryResult === null || tryActual !== undefined ? null : (
                  <p
                    data-testid="formula-try-result"
                    data-stale={tryFresh ? undefined : true}
                    {...stylex.props(styles.tryNote)}
                  >
                    {!tryFresh
                      ? format(m.resultStale)
                      : tryResult.refusal !== undefined
                        ? format(m.refusalPrefix, { message: tryResult.refusal })
                        : tryResult.defect !== undefined
                          ? format(m.defectPrefix, { message: tryResult.defect })
                          : format(m.testInputInvalid, { label: format(m.tryTitle) })}
                  </p>
                )}
                <div {...stylex.props(styles.trySaves)}>
                  <button
                    type="button"
                    disabled={archived || running}
                    onClick={() => {
                      saveTryAsCase('')
                      setTab('examples')
                    }}
                    {...stylex.props(styles.tryLink)}
                  >
                    <ListPlusIcon size={13} aria-hidden />
                    {format(m.trySave)}
                  </button>
                  {tryActual === undefined ? null : (
                    // a STALE actual may never become an expectation: the offer
                    // exists only while code and inputs both still match the run
                    <button
                      type="button"
                      data-testid="formula-try-adopt"
                      disabled={archived || running}
                      onClick={() => {
                        saveTryAsCase(tryActual)
                        setTab('examples')
                      }}
                      {...stylex.props(styles.tryLink)}
                    >
                      <EqualIcon size={13} aria-hidden />
                      {format(m.trySaveExpecting, { value: tryActual })}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
          <div aria-hidden {...stylex.props(styles.sideRule)} />
          <section {...stylex.props(styles.versionsPart)}>
            <div {...stylex.props(styles.sideHead)}>
              <h2 {...stylex.props(styles.sideTitle)}>{format(m.versionsTitle)}</h2>
            </div>
            <div {...stylex.props(styles.versionsScroll)}>
              {sortedVersions.length === 0 ? (
                <p {...stylex.props(styles.sideEmpty)}>{format(m.versionsEmpty)}</p>
              ) : (
                <ol data-testid="formula-versions" {...stylex.props(styles.versions)}>
                  {sortedVersions.map((version) => {
                    const latest = version.versionNo === fn.latestVersionNo
                    return (
                      <li
                        key={version.versionNo}
                        data-version={version.versionNo}
                        {...stylex.props(styles.version)}
                      >
                        <div {...stylex.props(styles.versionHead)}>
                          <span
                            {...stylex.props(styles.versionNo, latest && styles.versionNoLatest)}
                          >
                            {format(m.versionNumber, { number: version.versionNo })}
                          </span>
                          {latest && (
                            <span {...stylex.props(styles.standing, styles.standingPublished)}>
                              {format(m.versionLatest)}
                            </span>
                          )}
                          <span {...stylex.props(styles.spring)} />
                          <span
                            title={version.contractSha256.slice(0, 12)}
                            {...stylex.props(styles.versionWhen)}
                          >
                            {format(m.versionPublishedOn, {
                              date: shortWhen(version.publishedAt, format, locale),
                            })}
                          </span>
                        </div>
                        <VersionSharing functionId={functionId} versionNo={version.versionNo} />
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          </section>
        </aside>
      </div>

      <Tabs value={tab} onValueChange={(next) => setTab(next as PanelTab)} xstyle={styles.panel}>
        <div {...stylex.props(styles.panelBar)}>
          <TabsList aria-label={format(m.panelLabel)} xstyle={styles.tabList}>
            <TabsTrigger value="examples" xstyle={styles.tab}>
              <span {...stylex.props(styles.tabWords)}>
                <ToneDot tone={examplesTone} />
                {format(m.testsTitle)}
                <span {...stylex.props(styles.tabCount)}>{tests.length}</span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="compile" xstyle={styles.tab}>
              <span {...stylex.props(styles.tabWords)}>
                <ToneDot tone={compileTone} />
                {format(m.diagnosticsTitle)}
              </span>
            </TabsTrigger>
            <TabsTrigger value="contract" xstyle={styles.tab}>
              <span {...stylex.props(styles.tabWords)}>
                <ToneDot tone={contractTone} />
                {format(m.contractIssuesTitle)}
              </span>
            </TabsTrigger>
          </TabsList>
          <span {...stylex.props(styles.spring)} />
          <Button
            variant="outline"
            size="xs"
            disabled={archived || running || tests.length === 0}
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
        </div>

        <TabsContent value="examples" xstyle={styles.panelBody}>
          <div {...stylex.props(exampleStyles.columns, exampleStyles.head)}>
            <span>{format(m.testName)}</span>
            <span {...stylex.props(exampleStyles.wide)}>{format(m.examplesInputColumn)}</span>
            <span {...stylex.props(exampleStyles.wide, exampleStyles.end)}>
              {format(m.examplesExpectedColumn)}
            </span>
            <span {...stylex.props(exampleStyles.wide, exampleStyles.end)}>
              {format(m.reportActualColumn)}
            </span>
            <span>{format(m.reportOutcome)}</span>
            <span />
          </div>
          <div {...stylex.props(styles.panelScroll)}>
            {cases.length === 0 ? (
              <div {...stylex.props(styles.emptyFill)}>
                <EmptyRow>{format(m.examplesEmpty)}</EmptyRow>
              </div>
            ) : (
              cases.map((one) => (
                <ExampleRow
                  key={one.test.key}
                  index={one.index}
                  name={one.test.name}
                  inputSummary={inputSummaryOf(one.test.inputText)}
                  expected={one.test.expected}
                  outcome={
                    one.outcome === undefined
                      ? undefined
                      : {
                          ...(one.outcome.passed === undefined
                            ? {}
                            : { passed: one.outcome.passed }),
                          ...(one.outcome.actual === undefined
                            ? {}
                            : { actual: one.outcome.actual }),
                          ...(one.outcome.refusal === undefined
                            ? {}
                            : { refusal: one.outcome.refusal }),
                          ...(one.outcome.defect === undefined
                            ? {}
                            : { defect: one.outcome.defect }),
                          stale: one.stale,
                        }
                  }
                  verdict={one.verdict}
                  legal={one.legal}
                  open={sheetOpen && editingKey === one.test.key}
                  onOpen={() => openCase(one.test.key)}
                  locked={archived}
                  running={running}
                  onRun={() => void runRows([one.test.key])}
                  onLoadIntoTry={() => loadIntoTry(one.test)}
                  onDuplicate={() => setTests([...tests, { ...one.test, key: newTestKey() }])}
                  onRemove={() => setTests(tests.filter((held) => held.key !== one.test.key))}
                />
              ))
            )}
          </div>
          {/* with nothing listed, the line in the middle already says it */}
          {cases.length === 0 ? null : (
            <div data-testid="formula-examples-summary" {...stylex.props(styles.panelFoot)}>
              <span>{summary}</span>
              {adoptable === null || archived ? null : (
                <button
                  type="button"
                  onClick={() => editCase(adoptable.key, { expected: adoptable.actual })}
                  {...stylex.props(styles.footAction)}
                >
                  {format(m.adoptActual, { value: adoptable.actual })}
                </button>
              )}
              <span {...stylex.props(styles.spring)} />
              {cases.length === 0 ? null : (
                <>
                  <span aria-hidden {...stylex.props(styles.footRule)} />
                  <span {...stylex.props(styles.footTotal)}>
                    {format(m.examplesTotal, { count: cases.length })}
                  </span>
                </>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="compile" xstyle={styles.panelBody}>
          <div
            data-testid="formula-compile-state"
            data-state={compileState}
            {...stylex.props(styles.panelScroll)}
          >
            {compileState === 'passed' ? (
              <div {...stylex.props(styles.verdictBlock)}>
                <CircleCheckIcon size={30} aria-hidden {...stylex.props(styles.verdictGood)} />
                <span {...stylex.props(styles.verdictWords)}>{format(m.compileReady)}</span>
              </div>
            ) : compileState === 'working' ? (
              <div role="status" {...stylex.props(styles.verdictBlock)}>
                <Spinner aria-hidden xstyle={styles.verdictSpinner} />
                <span {...stylex.props(styles.verdictQuiet)}>{structureWords}</span>
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
                {diagnostics.length === 0 ? (
                  refusalWords === null ? null : (
                    <p {...stylex.props(styles.contractNote)}>{refusalWords}</p>
                  )
                ) : (
                  <table {...stylex.props(styles.reportTable)} data-testid="formula-diagnostics">
                    <tbody>
                      {diagnostics.map((row, index) => (
                        <tr key={index}>
                          <td {...stylex.props(styles.reportCell, styles.mono, styles.fit)}>
                            {row.line}:{row.column}
                          </td>
                          <td {...stylex.props(styles.reportCell, styles.mono, styles.fit)}>
                            {row.code}
                          </td>
                          <td {...stylex.props(styles.reportCell)}>{row.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {packagerWords === undefined ? null : (
                  <pre {...stylex.props(styles.detail)}>{packagerWords}</pre>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="contract" xstyle={styles.panelBody}>
          <div {...stylex.props(styles.panelScroll)}>
            {issues.length === 0 ? null : (
              <div {...stylex.props(styles.issues)}>
                <table {...stylex.props(styles.reportTable)} data-testid="formula-contract-issues">
                  <tbody>
                    {issues.map((row, index) => (
                      <tr key={index} data-reason={row.reason}>
                        <td {...stylex.props(styles.reportCell, styles.mono)}>{row.path}</td>
                        <td {...stylex.props(styles.reportCell)}>
                          {contractReasonText(row.reason)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {contractDetail === undefined ? null : (
                  <pre {...stylex.props(styles.detail)}>{contractDetail}</pre>
                )}
              </div>
            )}
            {contract === null ? (
              <p {...stylex.props(styles.contractNote)}>{structureWords}</p>
            ) : (
              <>
                {structure === 'synced' ? null : (
                  <p {...stylex.props(styles.contractNote)}>{structureWords}</p>
                )}
                <ContractTable
                  inputSchema={contract.inputSchema}
                  outputSchema={contract.outputSchema}
                />
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Sheet
        open={sheetOpen && editingCase !== undefined}
        onOpenChange={(open) => {
          if (!open) setSheetOpen(false)
        }}
      >
        <SheetContent side={narrow ? 'bottom' : 'right'} xstyle={styles.caseSheet}>
          <SheetHeader>
            <SheetTitle>{format(m.exampleEditTitle)}</SheetTitle>
            {editingCase === undefined ? null : (
              <SheetDescription>
                {editingCase.outcome === undefined
                  ? format(m.conclusionNotRun)
                  : editingCase.stale
                    ? format(m.resultStale)
                    : (outcomeNotes(editingCase.outcome) ??
                      (editingCase.outcome.actual === undefined
                        ? format(m.resultPassed)
                        : format(m.resultActual, { value: editingCase.outcome.actual })))}
              </SheetDescription>
            )}
          </SheetHeader>
          {editingCase === undefined ? null : (
            <div
              data-testid="formula-case-editor"
              data-legal={editingCase.legal}
              {...stylex.props(styles.caseBody)}
            >
              {caseFields(editingCase.test, editingCase.legal, null)}
            </div>
          )}
          {editingCase === undefined ? null : (
            <SheetFooter xstyle={styles.caseFoot}>
              <Button
                variant="outline"
                size="sm"
                disabled={archived || running}
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
              <span {...stylex.props(styles.spring)} />
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
    </div>
  )
}
