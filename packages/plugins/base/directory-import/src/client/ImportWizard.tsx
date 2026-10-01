import {
  useRunApi,
  useApiMutation,
  UiSlot,
  useApi,
  useApiQuery,
  useLoadFailure,
} from '@qualy/web-runtime'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assertNever, formatPlatformFailure, getApiErrorCode } from '@qualy/web-i18n'

import { useMemo, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'

import {
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  InfoIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'

import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { upload } from '@qualy/plugin-storage/client'
import { orgNodePicker, type OrgNodePickerContext, type PickedOrgNode } from '@qualy/ui-contract'
import { type ApiResult } from '@qualy/web-runtime/api'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, Field, Feedback, FormDialog, RequiredMark } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Dropzone } from '@qualy/ui/dropzone'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Spinner } from '@qualy/ui/spinner'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { Pager } from '@qualy/ui/pager'
import { type ResourceFailure } from '@qualy/ui/resource-state'
import { toast } from '@qualy/ui/toast'
import { directoryApi } from './api.ts'
import { FlowFrame, type FlowAction } from './flow.tsx'

import { csvOf } from './take-away.ts'
import { issueText, type IssueLike } from './words.ts'
import * as m from '#messages'

// People from a spreadsheet, in five short steps: the file, the sheet, the
// columns, what the check found, and the record it became. The server does
// every reading of the file; this screen collects choices and shows answers.
//
// The one thing it works hardest at is the third step. What the reader is
// building there is a path - everyone under this unit, then a level per
// column - and a column of dropdowns asks them to assemble that path in
// their head. So the assembled path is drawn beside the dropdowns, with the
// file's own first row standing in it, and it is recomputed on every change:
// beside the form under a pointer, pinned over the buttons under a thumb.

const styles = stylex.create({
  stack: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 14 },
  fills: { display: 'flex', minHeight: 0, minWidth: 0, flexGrow: 1, flexDirection: 'column' },
  row: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 10 },
  spring: { flexGrow: 1 },
  quiet: { margin: 0, fontSize: 12, lineHeight: 1.55, color: tokens.mutedForeground },
  sectionTitle: { margin: 0, fontSize: 13, fontWeight: 600 },
  sectionHead: { display: 'flex', minWidth: 0, alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },

  /** a white panel inside the flow's own body, which is already inset */
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}`,
  },
  cardFills: { minHeight: 0, flexGrow: 1 },
  cardPad: { gap: 10, paddingInline: 14, paddingBlock: 14 },
  cardHead: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    minHeight: 42,
    paddingInline: 14,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 13,
  },
  cardTitle: { fontSize: 13, fontWeight: 600 },
  cardFoot: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingInline: 14,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  scroller: { minHeight: 0, flexGrow: 1, overflowY: 'auto' },

  // ---- step 1: the file ------------------------------------------------
  prep: {
    display: 'grid',
    flexShrink: 0,
    alignItems: 'start',
    gap: 16,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) minmax(0, 1.15fr)',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
  },
  rule: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 12.5,
    lineHeight: 1.55,
    color: tokens.surfaceMutedForeground,
  },
  ruleNo: { flexShrink: 0, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  sample: {
    overflowX: 'auto',
    borderRadius: 10,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'start',
    whiteSpace: 'nowrap',
    paddingInline: 10,
    paddingBlock: 8,
    fontWeight: 500,
    color: tokens.mutedForeground,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  td: {
    paddingInline: 10,
    paddingBlock: 8,
    whiteSpace: 'nowrap',
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  /** the way in, given whatever room the rules above it left */
  dropSeat: { minHeight: '9rem', flexGrow: 1 },
  dropWords: { display: 'flex', alignItems: 'center', gap: 8 },

  // ---- step 2: the sheet -----------------------------------------------
  fileBar: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    paddingInline: 12,
    paddingBlock: 10,
    borderRadius: 12,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  fileMark: {
    display: 'inline-flex',
    width: 30,
    height: 30,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: tokens.surface,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    color: tokens.mutedForeground,
  },
  fileWords: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  fileName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13.5,
    fontWeight: 500,
  },
  fileFacts: { fontSize: 12, fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  pair: {
    display: 'grid',
    flexShrink: 0,
    gap: 14,
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
  },

  // ---- step 3: the columns ---------------------------------------------
  split: {
    display: 'grid',
    minHeight: 0,
    alignItems: 'start',
    gap: 20,
    gridTemplateColumns: 'minmax(0, 1fr) 17rem',
  },
  trio: {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: {
      default: 'repeat(3, minmax(0, 1fr))',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
  },
  pickerSeat: { display: 'flex', height: '14rem', minHeight: 0, flexDirection: 'column' },
  /** a select standing as a grid item, which fills its track rather than its words */
  wide: { width: '100%' },
  // Narrow, a label over every control makes three rows into six. The name
  // goes beside what it names, in a column narrow enough to read down.
  said: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 10 },
  saidWord: {
    flexShrink: 0,
    width: '3.5rem',
    fontSize: 12.5,
    color: tokens.surfaceMutedForeground,
  },
  saidSeat: { display: 'flex', minWidth: 0, flexGrow: 1 },
  // where the unit is not chosen here but shown and changed elsewhere
  anchorPress: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    height: 40,
    paddingInline: 12,
    borderWidth: 0,
    borderRadius: 10,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    backgroundColor: {
      default: tokens.surface,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, ${tokens.surface})`,
    },
    fontFamily: 'inherit',
    fontSize: 14,
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
  },
  anchorWord: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  level: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto',
    alignItems: 'center',
  },
  levelNo: {
    display: 'inline-flex',
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 11,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.surfaceMutedForeground,
  },
  levelPhone: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr) auto',
    alignItems: 'center',
  },
  rail: {
    // The answer stays in sight while the form scrolls past it: that is the
    // whole point of drawing the path, and a rail that scrolled away with
    // the dropdown being changed would show it only when it did not matter.
    position: 'sticky',
    insetBlockStart: 0,
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  railLabel: {
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: tokens.mutedForeground,
  },
  chain: { display: 'flex', minWidth: 0, flexDirection: 'column' },
  chainRow: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8, fontSize: 13 },
  chainDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.mutedForeground,
  },
  chainName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  },
  chainFrom: { paddingLeft: 14, fontSize: 12, color: tokens.mutedForeground },
  chainLine: {
    width: 1,
    height: 12,
    marginLeft: 2.5,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 15%, transparent)`,
  },
  hairline: { height: 1, backgroundColor: tokens.divider },
  example: {
    paddingInline: 10,
    paddingBlock: 8,
    borderRadius: 8,
    backgroundColor: tokens.surface,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    fontSize: 12,
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  /** the same three lines, pinned over a phone's buttons */
  pinned: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 5,
    paddingInline: 12,
    paddingBlock: 10,
    borderRadius: 11,
    backgroundColor: tokens.surfaceInset,
  },
  pinnedLabel: {
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: tokens.mutedForeground,
  },
  pinnedPath: { fontSize: 12.5, lineHeight: 1.5, wordBreak: 'break-word' },
  pinnedBad: { color: tokens.danger },

  // ---- step 4: the check -----------------------------------------------
  tally: {
    display: 'grid',
    flexShrink: 0,
    gap: 10,
    gridTemplateColumns: {
      default: 'minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)',
      [breakpoints.phone]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  tallyCell: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 3,
    paddingInline: 14,
    paddingBlock: 12,
    borderRadius: 12,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}`,
  },
  tallyLabel: { fontSize: 11.5, color: tokens.mutedForeground },
  tallyValue: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13.5,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
  },
  found: {
    display: 'grid',
    minHeight: 0,
    flexGrow: 1,
    gap: 14,
    gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)',
  },
  bad: { color: tokens.danger },
  badDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.danger,
  },
  okDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.success,
  },
  issue: {
    display: 'grid',
    gridTemplateColumns: { default: '5rem minmax(0, 1fr)', [breakpoints.phone]: 'minmax(0, 1fr)' },
    columnGap: 12,
    rowGap: 3,
    alignItems: 'baseline',
    paddingInline: 14,
    paddingBlock: { default: 10, [breakpoints.phone]: 10 },
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  issueWhere: { fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  issueWhat: { fontSize: 13, lineHeight: 1.5 },
  nodePath: {
    display: 'flex',
    alignItems: 'center',
    minHeight: 32,
    paddingInline: 14,
    fontSize: 12.5,
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  clean: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingInline: 14,
    paddingBlock: 14,
    fontSize: 13,
  },

  // ---- step 5: the record it became ------------------------------------
  crown: {
    display: 'flex',
    flexShrink: 0,
    alignItems: { default: 'flex-start', [breakpoints.phone]: 'center' },
    flexDirection: { default: 'row', [breakpoints.phone]: 'column' },
    gap: 12,
    paddingBlock: { default: 0, [breakpoints.phone]: 16 },
  },
  seal: {
    display: 'inline-flex',
    width: { default: 34, [breakpoints.phone]: 52 },
    height: { default: 34, [breakpoints.phone]: 52 },
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    boxShadow: `inset 0 0 0 1.5px ${tokens.border}`,
    color: tokens.foreground,
  },
  crownWords: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: { default: 'flex-start', [breakpoints.phone]: 'center' },
    gap: 4,
    textAlign: { default: 'start', [breakpoints.phone]: 'center' },
  },
  crownTitle: { fontSize: { default: 17, [breakpoints.phone]: 19 }, fontWeight: 600 },
  crownLine: {
    fontSize: 13,
    lineHeight: 1.55,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  factLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 46,
    paddingInline: 14,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 13,
  },
  factLabel: { flexShrink: 0, color: tokens.mutedForeground },
  factValue: {
    minWidth: 0,
    marginLeft: 'auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  aside: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    paddingInline: 14,
    paddingBlock: 12,
    borderRadius: 12,
    backgroundColor: tokens.surfaceInset,
    fontSize: 12.5,
    lineHeight: 1.55,
    color: tokens.surfaceMutedForeground,
  },
  asideMark: { flexShrink: 0, marginTop: 2, color: tokens.mutedForeground },
  ways: { display: 'flex', flexWrap: 'wrap', gap: 10 },
})

type Inspect = ApiResult<typeof directoryApi, 'directory', 'inspectUserImportUpload'>
type Preview = ApiResult<typeof directoryApi, 'directory', 'previewUserImport'>
type Done = ApiResult<typeof directoryApi, 'directory', 'commitUserImport'>

interface Uploaded {
  readonly attachmentId: string
  readonly filename: string
  readonly size: number
}

interface LevelDraft {
  readonly key: number
  readonly orgTypeId: string
  readonly column: string
}

const XLSX = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
}

/** problems of a checked file to a page */
const ISSUES_PER_PAGE = 10

/** the problems an invalid-import refusal lists, read without trusting its shape */
const issuesOf = (error: unknown): readonly IssueLike[] =>
  typeof error === 'object' && error !== null && 'issues' in error && Array.isArray(error.issues)
    ? error.issues.filter(isIssue)
    : []
const isIssue = (one: unknown): one is IssueLike =>
  typeof one === 'object' && one !== null && 'reason' in one && typeof one.reason === 'string'

const PHONE = 768

/** a size as a reader reads one, which is never in bytes past a kilobyte */
const sizeText = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * The five steps of one import, in the frame that holds them.
 *
 * It reports the record it made rather than navigating to it: where a record
 * opens is the roster's say, not this errand's.
 */
export function ImportWizard({
  open,
  anchorNodeId,
  onClose,
  onOpenRecord,
}: {
  open: boolean
  /** the unit the reader was looking at, offered as where the import hangs */
  anchorNodeId: string | null
  onClose: () => void
  onOpenRecord: (importId: string) => void
}) {
  const failures = useLoadFailure()
  const businessNo = useTerm(authTerms.businessNumber)
  const phone = useIsBelow(PHONE)
  const api = useApi(directoryApi)
  const query = useApiQuery(directoryApi)
  const queryClient = useQueryClient()

  const options = useQuery(query.directory.getUserImportOptions.queryOptions({}))

  const [at, setAt] = useState(0)
  const [uploaded, setUploaded] = useState<Uploaded | null>(null)
  const [sheet, setSheet] = useState('')
  const [headerRow, setHeaderRow] = useState('1')
  const [displayNameColumn, setDisplayNameColumn] = useState('')
  const [businessNoColumn, setBusinessNoColumn] = useState('')
  const [userTypeId, setUserTypeId] = useState('')
  const [anchor, setAnchor] = useState<string | null>(anchorNodeId)
  const [anchorNamed, setAnchorNamed] = useState<PickedOrgNode | null>(null)
  const [pickingAnchor, setPickingAnchor] = useState(false)
  const [levels, setLevels] = useState<readonly LevelDraft[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [issuePage, setIssuePage] = useState(1)

  const inspect = useQuery({
    ...query.directory.inspectUserImportUpload.queryOptions({
      params: { attachmentId: uploaded?.attachmentId ?? '' },
      query: {
        ...(sheet === '' ? {} : { sheet }),
        headerRow: headerRow.trim() === '' ? '1' : headerRow.trim(),
      },
    }),
    enabled: uploaded !== null && /^[1-9]\d{0,3}$/.test(headerRow.trim()),
    retry: false,
  })
  const table = inspect.data?.table
  const headers = useMemo(() => table?.headers ?? [], [table])
  // Why the sheet step could not read the file. Most of its refusals are
  // the file's own - not a workbook, a header row past its end, a file
  // gone from storage - and asking again changes nothing there, while
  // choosing another file or another row might.
  const inspectCode = inspect.isError ? getApiErrorCode(inspect.error) : undefined
  const fileAtFault =
    inspectCode === 'USER_IMPORT_INVALID' || inspectCode === 'USER_IMPORT_SOURCE_UNAVAILABLE'
  const inspectFailure = (error: unknown): ResourceFailure => {
    const code = getApiErrorCode(error)
    if (code === 'USER_IMPORT_INVALID') {
      const first = issuesOf(error)[0]
      return {
        kind: 'failed',
        title: m.sheet_unreadableTitle(),
        description: first === undefined ? m.error_invalid() : issueText(first, businessNo),
        retryable: false,
      }
    }
    if (code === 'USER_IMPORT_SOURCE_UNAVAILABLE') {
      return {
        kind: 'missing',
        title: m.sheet_sourceGoneTitle(),
        description: m.error_sourceUnavailable(),
        retryable: false,
      }
    }
    if (code === 'USER_IMPORT_BUSY') {
      return {
        ...failures.of(error),
        kind: 'unavailable',
        description: m.error_busy(),
        retryable: true,
      }
    }
    return failures.of(error)
  }

  const run = useRunApi()
  const uploading = useMutation({
    mutationFn: async (file: File) => {
      const ticket = await run(
        api.directory.prepareUserImportUpload({
          payload: {
            filename: file.name,
            declaredMime: file.type || 'application/octet-stream',
            size: String(file.size),
          },
        }),
      )
      await upload(
        {
          reservationId: ticket.reservationId,
          attachmentId: ticket.attachmentId,
          grant: ticket.grant,
          expiresAt: Date.parse(ticket.expiresAt),
        },
        file,
        {},
      )
      const meta = await run(
        api.directory.completeUserImportUpload({
          params: { reservationId: ticket.reservationId },
        }),
      )
      return {
        attachmentId: meta.id,
        filename: meta.filename,
        size: file.size,
      } satisfies Uploaded
    },
    onSuccess: (file) => {
      setUploaded(file)
      setSheet('')
      setPreview(null)
      setAt(1)
    },
    onError: (error) => {
      switch (getApiErrorCode(error)) {
        case 'USER_IMPORT_INVALID':
          toast.error(m.error_invalid())
          return
        case 'USER_IMPORT_SOURCE_UNAVAILABLE':
          toast.error(m.error_sourceUnavailable())
          return
        default:
          toast.error(formatPlatformFailure(error))
      }
    },
  })

  const mapping = () => ({
    displayName: { column: displayNameColumn },
    businessNo: { column: businessNoColumn },
    organization: {
      anchorNodeId: anchor,
      levels: levels.map((level) => ({ orgTypeId: level.orgTypeId, column: level.column })),
    },
  })
  const request = () => ({
    attachmentId: uploaded?.attachmentId ?? '',
    sheet: table?.sheet ?? sheet,
    headerRow: Number(headerRow),
    userTypeId,
    mapping: mapping(),
  })

  const checking = useApiMutation({
    mutationFn: () => api.directory.previewUserImport({ payload: request() }),
    onSuccess: (found) => {
      setPreview(found)
      setIssuePage(1)
      setAt(3)
    },
    onError: (error) => {
      switch (error._tag) {
        case 'USER_IMPORT_BUSY':
          toast.error(m.error_busy())
          return
        case 'USER_IMPORT_INVALID':
          toast.error(m.error_invalid())
          return
        case 'USER_IMPORT_MAPPING_INVALID':
          toast.error(m.error_mappingInvalid())
          return
        case 'USER_IMPORT_SOURCE_UNAVAILABLE':
          toast.error(m.error_sourceUnavailable())
          return
        case 'USER_IMPORT_SOURCE_USED':
          toast.error(m.error_sourceUsed())
          return
        default:
          assertNever(error)
      }
    },
  })

  const committing = useApiMutation({
    mutationFn: () =>
      api.directory.commitUserImport({
        payload: { ...request(), expectedPlanFingerprint: preview?.planFingerprint ?? '' },
      }),
    onSuccess: (result) => {
      setDone(result)
      setAt(4)
      void queryClient.invalidateQueries({ queryKey: query.directory.listUserImports.key() })
    },
    onError: (error) => {
      switch (error._tag) {
        case 'USER_IMPORT_BUSY':
          toast.error(m.error_busy())
          return
        case 'USER_IMPORT_INVALID':
          toast.error(m.error_invalid())
          return
        case 'USER_IMPORT_MAPPING_INVALID':
          toast.error(m.error_mappingInvalid())
          return
        case 'USER_IMPORT_PLAN_CHANGED':
          toast.error(m.error_planChanged())
          return
        case 'USER_IMPORT_SOURCE_UNAVAILABLE':
          toast.error(m.error_sourceUnavailable())
          return
        case 'USER_IMPORT_SOURCE_USED':
          toast.error(m.error_sourceUsed())
          return
        default:
          assertNever(error)
      }
    },
  })

  const mappingReady =
    displayNameColumn !== '' &&
    businessNoColumn !== '' &&
    userTypeId !== '' &&
    levels.every((level) => level.orgTypeId !== '' && level.column !== '')
  const restart = () => {
    setUploaded(null)
    setPreview(null)
    setDone(null)
    setAt(0)
  }

  const steps = [m.step_upload, m.step_sheet, m.step_mapping, m.step_preview, m.step_done].map(
    (step) => step(),
  )
  const orgTypes = options.data?.orgTypes ?? []
  const nonRootTypes = orgTypes.filter((type) => type.id !== options.data?.root?.orgTypeId)
  const typeName = (id: string) => orgTypes.find((type) => type.id === id)?.name ?? ''
  const columnName = (column: string) =>
    headers.find((header) => header.column === column)?.text ?? column

  // Where everyone in this file will stand, assembled: the unit they all
  // hang under, then one level per column. It is the third step's whole
  // question, and nothing but this answers it before the check runs.
  const anchorLabel =
    anchor === null
      ? (options.data?.root?.name ?? m.mapping_anchorRoot())
      : anchorNamed !== null && anchorNamed.id === anchor
        ? anchorNamed.path
        : m.mapping_anchorChosen()
  const firstRow = table?.sample[0]
  const examplePath = [
    anchorLabel,
    ...levels.map((level) => firstRow?.cells[level.column] ?? ''),
  ].filter((part) => part !== '')
  const exampleName = firstRow?.cells[displayNameColumn] ?? ''

  const chain = (
    <div {...stylex.props(styles.chain)}>
      <div {...stylex.props(styles.chainRow)}>
        <span aria-hidden {...stylex.props(styles.chainDot)} />
        <span {...stylex.props(styles.chainName)}>{anchorLabel}</span>
      </div>
      {levels.map((level) => (
        <div key={level.key}>
          <span aria-hidden {...stylex.props(styles.chainLine)} />
          <div {...stylex.props(styles.chainRow)}>
            <span aria-hidden {...stylex.props(styles.chainDot)} />
            <span {...stylex.props(styles.chainName)}>
              {level.orgTypeId === '' ? m.mapping_levelTypeUnset() : typeName(level.orgTypeId)}
            </span>
          </div>
          <span {...stylex.props(styles.chainFrom)}>
            {level.column === ''
              ? m.mapping_columnUnset()
              : m.mapping_levelFrom({ column: columnName(level.column) })}
          </span>
        </div>
      ))}
    </div>
  )

  /** what the file's own first row comes to, which is the proof the path is right */
  const exampleLine =
    examplePath.length === 0
      ? m.mapping_exampleUnready()
      : [examplePath.join(' / '), exampleName].filter((part) => part !== '').join(' - ')

  const addLevel = () =>
    setLevels((current) => [...current, { key: Date.now(), orgTypeId: '', column: '' }])
  const setLevel = (key: number, patch: Partial<LevelDraft>) =>
    setLevels((current) => current.map((one) => (one.key === key ? { ...one, ...patch } : one)))
  const dropLevel = (key: number) =>
    setLevels((current) => current.filter((one) => one.key !== key))

  const anchorPicker = (
    <UiSlot
      token={orgNodePicker}
      context={
        {
          value: anchor === null ? [] : [anchor],
          onChange: (ids, picked) => {
            setAnchor(ids[0] ?? null)
            setAnchorNamed(picked[0] ?? null)
          },
          single: true,
          fill: true,
        } satisfies OrgNodePickerContext
      }
      fallback={<Feedback message={m.mapping_anchorRoot()} />}
    />
  )

  /** a name beside what it names, which is a phone's shape for a short form */
  const said = (label: string, control: ReactNode, required = false) => (
    <label {...stylex.props(styles.said)}>
      <span {...stylex.props(styles.saidWord)}>
        {label}
        {required && <RequiredMark />}
      </span>
      <span {...stylex.props(styles.saidSeat)}>{control}</span>
    </label>
  )

  const columnChoice = (
    label: string,
    value: string,
    onChange: (column: string) => void,
    testId: string,
  ) => (
    <Field label={label} required>
      {(id, control) => (
        <Select value={value === '' ? undefined : value} onValueChange={onChange}>
          <SelectTrigger id={id} {...control} data-testid={testId}>
            <SelectValue placeholder={m.mapping_columnUnset()} />
          </SelectTrigger>
          <SelectContent>
            {headers.map((header) => (
              <SelectItem key={header.column} value={header.column}>
                {header.text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  )

  // ---- what the frame is told, step by step -----------------------------
  const errors = preview?.users.errors ?? 0
  const actions: FlowAction[] = (() => {
    if (at === 0) {
      return [
        {
          key: 'next',
          label: m.step_next(),
          onClick: () => setAt(1),
          disabled: true,
          lead: true,
        },
      ]
    }
    if (at === 1) {
      return [
        {
          key: 'next',
          label: m.step_next(),
          onClick: () => setAt(2),
          disabled: table === undefined || headers.length === 0,
          lead: true,
        },
      ]
    }
    if (at === 2) {
      return [
        {
          key: 'check',
          label: (checking.isPending ? m.mapping_checking : m.mapping_check)(),
          onClick: () => checking.mutate(),
          disabled: !mappingReady,
          pending: checking.isPending,
          lead: true,
        },
      ]
    }
    if (at === 3) {
      return [
        ...(phone
          ? [
              {
                key: 'replace',
                label: m.upload_replace(),
                onClick: restart,
                variant: 'outline' as const,
              },
            ]
          : []),
        {
          key: 'commit',
          label: committing.isPending
            ? m.preview_committing()
            : m.preview_commitCount({ count: preview?.rowCount ?? 0 }),
          onClick: () => committing.mutate(),
          disabled: errors > 0,
          pending: committing.isPending,
          lead: true,
        },
      ]
    }
    return [
      ...(phone
        ? [
            {
              key: 'record',
              label: m.done_openRecord(),
              onClick: () => done !== null && onOpenRecord(done.importId),
              variant: 'outline' as const,
            },
            {
              key: 'again',
              label: m.done_another(),
              onClick: restart,
              variant: 'outline' as const,
            },
          ]
        : []),
      { key: 'finish', label: m.step_finish(), onClick: onClose, lead: true },
    ]
  })()

  const note = (() => {
    if (at === 0) return m.upload_scope({ path: anchorLabel })
    if (at === 3 && errors > 0) return m.preview_issuesHint()
    return null
  })()

  const subtitle =
    uploaded === null
      ? m.import_hint()
      : [uploaded.filename, table?.sheet, m.inspect_rowCount({ count: table?.rowCount ?? 0 })]
          .filter((part) => part !== undefined && part !== '')
          .join('　')

  return (
    <FlowFrame
      open={open}
      testId="import-wizard"
      title={m.import_title()}
      subtitle={subtitle}
      steps={steps}
      step={at}
      cancelLabel={m.dialog_cancel()}
      closeLabel={m.record_close()}
      actions={actions}
      note={note}
      {...(at === 2 && !phone ? {} : {})}
      {...(at === 4 ? {} : { onClose })}
      {...(at > 0 && at < 4 ? { onBack: () => setAt(at - 1), backLabel: m.step_back() } : {})}
      {...(at < 4 ? { onStep: (index: number) => index < at && setAt(index) } : {})}
      {...(phone && at === 2
        ? {
            pinned: (
              <div {...stylex.props(styles.pinned)} data-testid="import-example">
                <span {...stylex.props(styles.pinnedLabel)}>{m.mapping_example()}</span>
                <span {...stylex.props(styles.pinnedPath)}>{exampleLine}</span>
              </div>
            ),
          }
        : {})}
    >
      <div {...stylex.props(styles.fills)} data-testid="import-body" data-step={at}>
        {at === 0 && (
          <div {...stylex.props(styles.fills, styles.stack)}>
            {/* what to bring, before it is asked for: a reader handed a drop
                target and nothing else finds out what the file should have
                looked like from the errors of the one they guessed at */}
            <div {...stylex.props(styles.prep)} data-testid="import-prep">
              <div {...stylex.props(styles.card, styles.cardPad)}>
                <span {...stylex.props(styles.cardTitle)}>{m.prep_title()}</span>
                {[
                  m.prep_people({ businessNo }),
                  m.prep_units(),
                  m.prep_header(),
                  m.prep_existing({ businessNo }),
                ].map((line, index) => (
                  <span key={line} {...stylex.props(styles.rule)}>
                    <span {...stylex.props(styles.ruleNo)}>{index + 1}</span>
                    <span>{line}</span>
                  </span>
                ))}
              </div>
              {/* A sample to copy is a pointer's aid: nobody builds a
                  spreadsheet on a handset, so narrow it is the four rules and
                  the file picker, and the columns are named in rule one. */}
              {!phone && (
                <div {...stylex.props(styles.sample)} aria-hidden>
                  <table {...stylex.props(styles.table)}>
                    <thead>
                      <tr>
                        {[
                          businessNo,
                          m.mapping_displayName(),
                          ...m.prep_sampleUnits().split('|'),
                        ].map((head) => (
                          <th key={head} {...stylex.props(styles.th)}>
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {m
                        .prep_sampleRows()
                        .split(';')
                        .map((line) => (
                          <tr key={line}>
                            {line.split('|').map((cell, index) => (
                              <td key={index} {...stylex.props(styles.td)}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <Dropzone
              accept={XLSX}
              multiple={false}
              maxFiles={1}
              disabled={uploading.isPending}
              xstyle={styles.dropSeat}
              onFiles={(files) => {
                const file = files[0]
                if (file !== undefined) uploading.mutate(file)
              }}
            >
              <span {...stylex.props(styles.dropWords)}>
                {uploading.isPending ? <Spinner /> : <FileSpreadsheetIcon aria-hidden />}
                {(uploading.isPending ? m.upload_uploading : m.upload_choose)()}
              </span>
              <span {...stylex.props(styles.quiet)}>{m.upload_rule()}</span>
            </Dropzone>
          </div>
        )}

        {at === 1 && uploaded !== null && (
          <div {...stylex.props(styles.fills, styles.stack)}>
            <div {...stylex.props(styles.fileBar)}>
              <span aria-hidden {...stylex.props(styles.fileMark)}>
                <FileSpreadsheetIcon size={15} />
              </span>
              <span {...stylex.props(styles.fileWords)}>
                <span {...stylex.props(styles.fileName)}>{uploaded.filename}</span>
                <span {...stylex.props(styles.fileFacts)}>
                  {[
                    sizeText(uploaded.size),
                    m.sheet_count({ count: inspect.data?.sheets.length ?? 0 }),
                  ].join('　')}
                </span>
              </span>
              <span {...stylex.props(styles.spring)} />
              <Button variant="ghost" size="sm" onClick={restart}>
                {m.upload_replace()}
              </Button>
            </div>
            <div {...stylex.props(styles.pair)}>
              <Field label={m.sheet_label()}>
                {(id) => (
                  <Select value={table?.sheet ?? sheet} onValueChange={setSheet}>
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(inspect.data?.sheets ?? []).map((one) => (
                        <SelectItem key={one.name} value={one.name}>
                          {one.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label={m.sheet_headerRow()} hint={m.sheet_headerRowHint()}>
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    value={headerRow}
                    onChange={(event) => setHeaderRow(event.target.value)}
                  />
                )}
              </Field>
            </div>
            <AsyncSection
              pending={inspect.isPending}
              error={inspect.isError ? inspectFailure(inspect.error) : null}
              errorAction={
                fileAtFault ? (
                  <Button variant="outline" size="sm" onClick={restart}>
                    {m.upload_replace()}
                  </Button>
                ) : undefined
              }
              loadingLabel={m.mapping_checking()}
              retryLabel={m.records_retry()}
              onRetry={() => void inspect.refetch()}
              xstyle={styles.fills}
            >
              {table !== undefined && (
                <div {...stylex.props(styles.fills, styles.stack)}>
                  <div {...stylex.props(styles.sectionHead)}>
                    <span {...stylex.props(styles.sectionTitle)}>{m.sheet_sample()}</span>
                    <Badge variant="secondary">
                      {m.sheet_shape({
                        rows: table.rowCount,
                        columns: headers.length,
                      })}
                    </Badge>
                  </div>
                  {headers.length === 0 ? (
                    <Feedback message={m.sheet_noHeaders()} />
                  ) : (
                    <div {...stylex.props(styles.sample, styles.fills)}>
                      <table {...stylex.props(styles.table)}>
                        <thead>
                          <tr>
                            {headers.map((header) => (
                              <th key={header.column} {...stylex.props(styles.th)}>
                                {header.text}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {table.sample.map((sampleRow) => (
                            <tr key={sampleRow.rowNo}>
                              {headers.map((header) => (
                                <td key={header.column} {...stylex.props(styles.td)}>
                                  {sampleRow.cells[header.column] ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </AsyncSection>
          </div>
        )}

        {at === 2 &&
          (phone ? (
            <div {...stylex.props(styles.stack)}>
              <div {...stylex.props(styles.card, styles.cardPad)}>
                <span {...stylex.props(styles.cardTitle)}>{m.mapping_people()}</span>
                {said(
                  m.mapping_displayName(),
                  <Select
                    value={displayNameColumn === '' ? undefined : displayNameColumn}
                    onValueChange={setDisplayNameColumn}
                  >
                    <SelectTrigger
                      data-testid="column-name"
                      xstyle={styles.wide}
                      aria-required
                      aria-label={m.mapping_displayName()}
                    >
                      <SelectValue placeholder={m.mapping_columnUnset()} />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((header) => (
                        <SelectItem key={header.column} value={header.column}>
                          {header.text}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>,
                  true,
                )}
                {said(
                  businessNo,
                  <Select
                    value={businessNoColumn === '' ? undefined : businessNoColumn}
                    onValueChange={setBusinessNoColumn}
                  >
                    <SelectTrigger
                      data-testid="column-business"
                      xstyle={styles.wide}
                      aria-required
                      aria-label={businessNo}
                    >
                      <SelectValue placeholder={m.mapping_columnUnset()} />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((header) => (
                        <SelectItem key={header.column} value={header.column}>
                          {header.text}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>,
                  true,
                )}
                {said(
                  m.mapping_userType(),
                  <Select
                    value={userTypeId === '' ? undefined : userTypeId}
                    onValueChange={setUserTypeId}
                  >
                    <SelectTrigger
                      data-testid="user-type"
                      xstyle={styles.wide}
                      aria-required
                      aria-label={m.mapping_userType()}
                    >
                      <SelectValue placeholder={m.mapping_userTypeUnset()} />
                    </SelectTrigger>
                    <SelectContent>
                      {(options.data?.userTypes ?? []).map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>,
                  true,
                )}
              </div>
              <div {...stylex.props(styles.card, styles.cardPad)}>
                <span {...stylex.props(styles.cardTitle)}>{m.mapping_levels()}</span>
                <span {...stylex.props(styles.quiet)}>
                  {m.mapping_anchorSaid({ path: anchorLabel })}
                </span>
                {said(
                  m.mapping_anchor(),
                  <button
                    type="button"
                    data-testid="anchor-press"
                    {...stylex.props(styles.anchorPress)}
                    onClick={() => setPickingAnchor(true)}
                  >
                    <span {...stylex.props(styles.anchorWord)}>{anchorLabel}</span>
                    <ChevronRightIcon size={14} aria-hidden />
                  </button>,
                )}
                {levels.map((level, index) => (
                  <div key={level.key} {...stylex.props(styles.levelPhone)}>
                    <span aria-hidden {...stylex.props(styles.levelNo)}>
                      {index + 1}
                    </span>
                    {levelType(level, setLevel, nonRootTypes)}
                    {levelColumn(level, setLevel, headers)}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={m.mapping_removeLevel()}
                      onClick={() => dropLevel(level.key)}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addLevel}>
                  <PlusIcon aria-hidden />
                  {m.mapping_addLevel()}
                </Button>
              </div>
            </div>
          ) : (
            <div {...stylex.props(styles.split)}>
              <div {...stylex.props(styles.stack)}>
                <div {...stylex.props(styles.trio)}>
                  {columnChoice(
                    m.mapping_displayName(),
                    displayNameColumn,
                    setDisplayNameColumn,
                    'column-name',
                  )}
                  {columnChoice(
                    businessNo,
                    businessNoColumn,
                    setBusinessNoColumn,
                    'column-business',
                  )}
                  <Field label={m.mapping_userType()} required>
                    {(id, control) => (
                      <Select
                        value={userTypeId === '' ? undefined : userTypeId}
                        onValueChange={setUserTypeId}
                      >
                        <SelectTrigger id={id} {...control} data-testid="user-type">
                          <SelectValue placeholder={m.mapping_userTypeUnset()} />
                        </SelectTrigger>
                        <SelectContent>
                          {(options.data?.userTypes ?? []).map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                </div>
                <span {...stylex.props(styles.quiet)}>{m.mapping_userTypeHint()}</span>

                <div {...stylex.props(styles.sectionHead)}>
                  <span {...stylex.props(styles.sectionTitle)}>{m.mapping_anchor()}</span>
                  <span {...stylex.props(styles.quiet)}>{m.mapping_anchorHint()}</span>
                </div>
                <div {...stylex.props(styles.pickerSeat)}>{anchorPicker}</div>

                <div {...stylex.props(styles.sectionHead)}>
                  <span {...stylex.props(styles.sectionTitle)}>{m.mapping_levels()}</span>
                  <span {...stylex.props(styles.quiet)}>{m.mapping_levelsHint()}</span>
                </div>
                {levels.map((level) => (
                  <div key={level.key} {...stylex.props(styles.level)}>
                    {levelType(level, setLevel, nonRootTypes)}
                    {levelColumn(level, setLevel, headers)}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={m.mapping_removeLevel()}
                      onClick={() => dropLevel(level.key)}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button variant="outline" size="sm" onClick={addLevel}>
                    <PlusIcon aria-hidden />
                    {m.mapping_addLevel()}
                  </Button>
                </div>
              </div>

              {/* The answer to the step, drawn rather than assembled in the
                  head: the path everyone lands on, and the file's own first
                  row standing in it. */}
              <div {...stylex.props(styles.rail)} data-testid="import-example">
                <span {...stylex.props(styles.railLabel)}>{m.mapping_chain()}</span>
                {chain}
                <span aria-hidden {...stylex.props(styles.hairline)} />
                <span {...stylex.props(styles.railLabel)}>{m.mapping_example()}</span>
                <span {...stylex.props(styles.example)}>{exampleLine}</span>
              </div>
            </div>
          ))}

        {at === 3 && preview !== null && (
          <div
            {...stylex.props(styles.fills, styles.stack)}
            data-testid="import-preview"
            data-errors={preview.users.errors}
          >
            <div {...stylex.props(styles.tally)}>
              {!phone && (
                <div {...stylex.props(styles.tallyCell)}>
                  <span {...stylex.props(styles.tallyLabel)}>{m.preview_chain()}</span>
                  <span {...stylex.props(styles.tallyValue)} title={chainText(preview)}>
                    {chainText(preview)}
                  </span>
                </div>
              )}
              <div {...stylex.props(styles.tallyCell)}>
                <span {...stylex.props(styles.tallyLabel)}>{m.preview_usersLabel()}</span>
                <span {...stylex.props(styles.tallyValue)}>
                  {m.preview_users({
                    create: preview.users.create,
                    existing: preview.users.existing,
                  })}
                </span>
              </div>
              <div {...stylex.props(styles.tallyCell)}>
                <span {...stylex.props(styles.tallyLabel)}>{m.preview_nodesLabel()}</span>
                <span {...stylex.props(styles.tallyValue)}>
                  {m.preview_nodes({
                    reused: preview.nodes.reused,
                    created: preview.nodes.created,
                  })}
                </span>
              </div>
            </div>

            <div {...stylex.props(phone ? styles.fills : styles.found)}>
              <div {...stylex.props(styles.card, styles.cardFills)} data-testid="import-issues">
                {errors === 0 ? (
                  <div {...stylex.props(styles.clean)}>
                    <span aria-hidden {...stylex.props(styles.okDot)} />
                    {m.preview_clean()}
                  </div>
                ) : (
                  <>
                    <div {...stylex.props(styles.cardHead)}>
                      <span aria-hidden {...stylex.props(styles.badDot)} />
                      <span {...stylex.props(styles.cardTitle, styles.bad)}>
                        {m.preview_errors({ count: errors })}
                      </span>
                    </div>
                    <div {...stylex.props(styles.scroller)}>
                      {preview.issues
                        .slice((issuePage - 1) * ISSUES_PER_PAGE, issuePage * ISSUES_PER_PAGE)
                        .map((issue, index) => (
                          <div
                            key={index}
                            {...stylex.props(styles.issue)}
                            data-testid="import-issue"
                          >
                            <span {...stylex.props(styles.issueWhere)}>
                              {issue.rowNo === null
                                ? m.issue_file()
                                : m.issue_row({ row: issue.rowNo })}
                            </span>
                            <span {...stylex.props(styles.issueWhat)}>
                              {issueText(issue, businessNo)}
                            </span>
                          </div>
                        ))}
                    </div>
                    {/* A file is fixed where it was written, which is not
                        here - so the way out of this step is taking the list
                        of what to fix with you. */}
                    <div {...stylex.props(styles.cardFoot)}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          takeAway(
                            uploaded?.filename ?? '',
                            preview.issues.map((issue) => [
                              issue.rowNo === null
                                ? m.issue_file()
                                : m.issue_row({ row: issue.rowNo }),
                              issueText(issue, businessNo),
                            ]),
                            [m.record_columnRow(), m.preview_issuesColumn()],
                          )
                        }
                      >
                        <DownloadIcon aria-hidden />
                        {m.preview_issuesTakeAway()}
                      </Button>
                      <span {...stylex.props(styles.spring)} />
                      {!phone && preview.issues.length > ISSUES_PER_PAGE && (
                        <Pager
                          testId="import-issues-pager"
                          label={m.pager()}
                          page={issuePage}
                          pageSize={ISSUES_PER_PAGE}
                          total={preview.issues.length}
                          onPage={setIssuePage}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>

              {!phone && (
                <div {...stylex.props(styles.card, styles.cardFills)}>
                  <div {...stylex.props(styles.cardHead)}>
                    <span {...stylex.props(styles.cardTitle)}>{m.preview_createdNodes()}</span>
                    <span {...stylex.props(styles.spring)} />
                    <span {...stylex.props(styles.tallyLabel)}>
                      {m.countOf({ count: preview.nodes.created })}
                    </span>
                  </div>
                  <div {...stylex.props(styles.scroller)}>
                    {preview.createdNodes.length === 0 ? (
                      <span {...stylex.props(styles.nodePath, styles.quiet)}>
                        {m.preview_noNewNodes()}
                      </span>
                    ) : (
                      preview.createdNodes.map((path) => (
                        <span key={path} {...stylex.props(styles.nodePath)}>
                          {path}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {at === 4 && done !== null && (
          <div {...stylex.props(styles.stack)} data-testid="import-done">
            <div {...stylex.props(styles.crown)}>
              <span aria-hidden {...stylex.props(styles.seal)}>
                <CheckIcon size={phone ? 24 : 17} />
              </span>
              <span {...stylex.props(styles.crownWords)}>
                <span {...stylex.props(styles.crownTitle)}>{m.done_title()}</span>
                <span {...stylex.props(styles.crownLine)}>
                  {m.done_summary({ users: done.createdUsers, nodes: done.createdNodes })}
                </span>
                {done.existingUsers > 0 && (
                  <span {...stylex.props(styles.crownLine)}>
                    {m.done_existing({ count: done.existingUsers })}
                  </span>
                )}
              </span>
            </div>
            <div {...stylex.props(styles.card)}>
              <div {...stylex.props(styles.factLine)}>
                <span {...stylex.props(styles.factLabel)}>{m.record_file()}</span>
                <span {...stylex.props(styles.factValue)}>{uploaded?.filename ?? ''}</span>
              </div>
              <div {...stylex.props(styles.factLine)}>
                <span {...stylex.props(styles.factLabel)}>{m.record_type()}</span>
                <span {...stylex.props(styles.factValue)}>
                  {(options.data?.userTypes ?? []).find((type) => type.id === userTypeId)?.name ??
                    ''}
                </span>
              </div>
              <div {...stylex.props(styles.factLine)}>
                <span {...stylex.props(styles.factLabel)}>{m.preview_chain()}</span>
                <span {...stylex.props(styles.factValue)}>
                  {[anchorLabel, ...levels.map((level) => typeName(level.orgTypeId))].join(' / ')}
                </span>
              </div>
            </div>
            <div {...stylex.props(styles.aside)}>
              <InfoIcon size={15} aria-hidden {...stylex.props(styles.asideMark)} />
              <span>{m.done_kept()}</span>
            </div>
            {/* A pointer has room for the two places to go next beside each
                other; a thumb finds them in the foot, where its own hand is. */}
            {!phone && (
              <div {...stylex.props(styles.ways)}>
                <Button onClick={() => onOpenRecord(done.importId)}>{m.done_openRecord()}</Button>
                <Button variant="outline" onClick={restart}>
                  {m.done_another()}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Narrow, the tree is not a thing that fits beside a form: it opens
          from the foot, answers the one question, and goes away again. */}
      <FormDialog
        open={pickingAnchor}
        title={m.mapping_anchor()}
        description={m.mapping_anchorHint()}
        onClose={() => setPickingAnchor(false)}
        footer={<Button onClick={() => setPickingAnchor(false)}>{m.mapping_anchorDone()}</Button>}
      >
        <div {...stylex.props(styles.pickerSeat)}>{anchorPicker}</div>
      </FormDialog>
    </FlowFrame>
  )
}

/** what the server made of the mapping, as one line of the check's summary */
function chainText(preview: Preview): string {
  return preview.chain
    .map((level) => (level.source === 'column' ? level.orgTypeName : level.detail))
    .join(' / ')
}

function levelType(
  level: LevelDraft,
  setLevel: (key: number, patch: Partial<LevelDraft>) => void,
  types: readonly { id: string; name: string }[],
) {
  return (
    <Select
      value={level.orgTypeId === '' ? undefined : level.orgTypeId}
      onValueChange={(next) => setLevel(level.key, { orgTypeId: next })}
    >
      <SelectTrigger aria-label={m.mapping_levelType()} xstyle={styles.wide}>
        <SelectValue placeholder={m.mapping_levelTypeUnset()} />
      </SelectTrigger>
      <SelectContent>
        {types.map((type) => (
          <SelectItem key={type.id} value={type.id}>
            {type.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function levelColumn(
  level: LevelDraft,
  setLevel: (key: number, patch: Partial<LevelDraft>) => void,
  headers: Inspect['table']['headers'],
) {
  return (
    <Select
      value={level.column === '' ? undefined : level.column}
      onValueChange={(next) => setLevel(level.key, { column: next })}
    >
      <SelectTrigger aria-label={m.mapping_columnUnset()} xstyle={styles.wide}>
        <SelectValue placeholder={m.mapping_columnUnset()} />
      </SelectTrigger>
      <SelectContent>
        {headers.map((header) => (
          <SelectItem key={header.column} value={header.column}>
            {header.text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The list of what to fix, as a file.
 *
 * A spreadsheet is corrected where it was written, and that is not in this
 * panel - so what the check found has to be able to leave with the reader.
 * The byte order mark is not decoration: without it a spreadsheet reads a
 * UTF-8 csv as the machine's own code page and every name comes out wrong.
 */
function takeAway(filename: string, rows: readonly (readonly string[])[], head: readonly string[]) {
  const body = csvOf([head, ...rows])
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = `${filename.replace(/\.[^.]+$/, '') || 'import'}.csv`
  link.click()
  URL.revokeObjectURL(href)
}
