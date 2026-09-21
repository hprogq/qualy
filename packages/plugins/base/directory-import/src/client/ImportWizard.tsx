import { useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheetIcon, PlusIcon, XIcon } from 'lucide-react'
import {
  UiSlot,
  useApi,
  useApiQuery,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { upload } from '@qualy/plugin-storage/client'
import { orgNodePicker, type OrgNodePickerContext } from '@qualy/ui-contract'
import type { ApiResult } from '@qualy/web-runtime/api'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, Field, Feedback } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Dropzone, FileTile } from '@qualy/ui/dropzone'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Spinner } from '@qualy/ui/spinner'
import { Steps } from '@qualy/ui/steps'
import {
  Card,
  CardEmpty,
  CardFoot,
  Cell,
  LeadWord,
  Table,
  TableHead,
  TableRow,
  Tag,
} from '@qualy/ui/screen'
import { Pager } from '@qualy/ui/pager'
import { toast } from '@qualy/ui/toast'
import { directoryApi } from './api.ts'
import { directoryImportMessages as m } from './i18n.ts'
import { issueText, whenText } from './words.ts'

// People from a spreadsheet, in five short steps: the file, the sheet, the
// columns, what the check found, and the record it became. The server does
// every reading of the file; this screen collects choices and shows answers.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 24 },
  split: {
    display: 'grid',
    gap: 24,
    alignItems: 'start',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 1024px)': 'minmax(0, 1fr) 20rem' },
  },
  wizard: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 20 },
  stack: { display: 'flex', flexDirection: 'column', gap: 16 },
  row: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  spacer: { flexGrow: 1 },
  dropWords: { display: 'flex', alignItems: 'center', gap: 8 },
  quiet: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  grid2: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 720px)': 'repeat(2, minmax(0, 1fr))' },
  },
  sample: { overflowX: 'auto', borderRadius: 10, boxShadow: `0 0 0 1px ${tokens.border}` },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'start',
    whiteSpace: 'nowrap',
    padding: 8,
    fontWeight: 500,
    color: tokens.mutedForeground,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  td: { padding: 8, whiteSpace: 'nowrap', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: tokens.divider },
  sectionTitle: { margin: 0, fontSize: 13, fontWeight: 600 },
  prep: {
    display: 'grid',
    alignItems: 'start',
    gap: 16,
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 820px)': 'minmax(0, 1fr) minmax(0, 1.1fr)' },
    // Stacked, four rules and a sample table stand between the reader and
    // the one thing this step asks for. The file goes first and the rules
    // read under it; nothing is committed until the preview step anyway.
    order: { default: null, [breakpoints.phone]: 1 },
  },
  prepWords: { display: 'flex', flexDirection: 'column', gap: 8 },
  prepList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    margin: 0,
    paddingLeft: 18,
    fontSize: 13,
    lineHeight: 1.55,
    color: tokens.surfaceMutedForeground,
  },
  prepSample: { backgroundColor: tokens.surface },
  issuePager: { paddingTop: 4 },
  level: { display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', alignItems: 'end' },
  // A seat with a height, because the picker grows into whatever it is
  // given: handed a box with only a ceiling, its list took the height it
  // computed from the window instead and drew straight over the field
  // below it.
  picker: { display: 'flex', minHeight: 0, height: '25rem', flexDirection: 'column' },
  recordsSeat: { minHeight: { default: '26rem', [breakpoints.phone]: '20rem' } },
  summary: { display: 'grid', gap: 12, gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 720px)': 'repeat(3, minmax(0, 1fr))' } },
  summaryCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: tokens.surfaceMuted,
  },
  summaryLabel: { fontSize: 12, color: tokens.mutedForeground },
  summaryValue: { fontSize: 14, fontWeight: 500 },
  ok: { color: tokens.success },
  bad: { color: tokens.danger },
  list: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 },
  record: {
    display: 'flex',
    width: '100%',
    flexDirection: 'column',
    gap: 2,
    paddingInline: 16,
    paddingBlock: 10,
    borderWidth: 0,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  recordName: { fontSize: 13, fontWeight: 500 },
  recordMeta: { fontSize: 12, color: tokens.mutedForeground },
})

type Options = ApiResult<typeof directoryApi, 'directory', 'getUserImportOptions'>
type Inspect = ApiResult<typeof directoryApi, 'directory', 'inspectUserImportUpload'>
type Preview = ApiResult<typeof directoryApi, 'directory', 'previewUserImport'>
type Done = ApiResult<typeof directoryApi, 'directory', 'commitUserImport'>

interface Uploaded {
  readonly attachmentId: string
  readonly filename: string
}

interface LevelDraft {
  readonly key: number
  readonly orgTypeId: string
  readonly column: string
}

const XLSX = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
}

/**
 * The five steps of one import, for whoever gives them a frame.
 *
 * It reports the record it made rather than navigating to it: the wizard sits
 * in a dialog over the roster, and where a record opens is the roster's say.
 */
export function ImportWizard({
  anchorNodeId,
  onOpenRecord,
}: {
  /** the unit the reader was looking at, offered as where the import hangs */
  anchorNodeId: string | null
  onOpenRecord: (importId: string) => void
}) {
  const { format, formatError } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const api = useApi(directoryApi)
  const query = useApiQuery(directoryApi)
  const run = useRunApi()
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
  const [levels, setLevels] = useState<readonly LevelDraft[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [issuePage, setIssuePage] = useState(1)

  const inspect = useQuery({
    ...query.directory.inspectUserImportUpload.queryOptions({
      params: { attachmentId: uploaded?.attachmentId ?? '' },
      query: { ...(sheet === '' ? {} : { sheet }), headerRow: headerRow.trim() === '' ? '1' : headerRow.trim() },
    }),
    enabled: uploaded !== null && /^[1-9]\d{0,3}$/.test(headerRow.trim()),
    retry: false,
  })
  const table = inspect.data?.table
  const headers = useMemo(() => table?.headers ?? [], [table])

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
        api.directory.completeUserImportUpload({ params: { reservationId: ticket.reservationId } }),
      )
      return { attachmentId: meta.id, filename: meta.filename } satisfies Uploaded
    },
    onSuccess: (file) => {
      setUploaded(file)
      setSheet('')
      setPreview(null)
      setAt(1)
    },
    onError: (error) => toast.error(formatError(error)),
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

  const checking = useMutation({
    mutationFn: () => run(api.directory.previewUserImport({ payload: request() })),
    onSuccess: (found) => {
      setPreview(found)
      setIssuePage(1)
      setAt(3)
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const committing = useMutation({
    mutationFn: () =>
      run(
        api.directory.commitUserImport({
          payload: { ...request(), expectedPlanFingerprint: preview?.planFingerprint ?? '' },
        }),
      ),
    onSuccess: (result) => {
      setDone(result)
      setAt(4)
      void queryClient.invalidateQueries({ queryKey: query.directory.listUserImports.key() })
    },
    onError: (error) => toast.error(formatError(error)),
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

  const steps = [m.stepUpload, m.stepSheet, m.stepMapping, m.stepPreview, m.stepDone].map((step) =>
    format(step),
  )
  const nonRootTypes = (options.data?.orgTypes ?? []).filter(
    (type) => type.id !== options.data?.root?.orgTypeId,
  )

  return (
          <div {...stylex.props(styles.wizard)} data-testid="import-wizard" data-step={at}>
            <Steps steps={steps} current={at} onSelect={(index) => index < at && done === null && setAt(index)} />

            {at === 0 && (
              <div {...stylex.props(styles.stack)}>
                {/* what to bring, before it is asked for: a reader handed a
                    drop target and nothing else finds out what the file should
                    have looked like from the errors of the one they guessed at */}
                <div {...stylex.props(styles.prep)} data-testid="import-prep">
                  <div {...stylex.props(styles.prepWords)}>
                    <p {...stylex.props(styles.sectionTitle)}>{format(m.prepTitle)}</p>
                    <ul {...stylex.props(styles.prepList)}>
                      <li>{format(m.prepPeople, { businessNo })}</li>
                      <li>{format(m.prepUnits)}</li>
                      <li>{format(m.prepHeader)}</li>
                      <li>{format(m.prepExisting, { businessNo })}</li>
                    </ul>
                  </div>
                  <div {...stylex.props(styles.sample, styles.prepSample)} aria-hidden>
                    <table {...stylex.props(styles.table)}>
                      <thead>
                        <tr>
                          {[businessNo, format(m.displayNameLabel), ...format(m.prepSampleUnits).split('|')].map(
                            (head) => (
                              <th key={head} {...stylex.props(styles.th)}>
                                {head}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {format(m.prepSampleRows)
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
                </div>
                <Dropzone
                  accept={XLSX}
                  multiple={false}
                  maxFiles={1}
                  disabled={uploading.isPending}
                  onFiles={(files) => {
                    const file = files[0]
                    if (file !== undefined) uploading.mutate(file)
                  }}
                >
                  <span {...stylex.props(styles.dropWords)}>
                    {uploading.isPending ? <Spinner /> : <FileSpreadsheetIcon aria-hidden />}
                    {format(uploading.isPending ? m.uploading : m.chooseFile)}
                  </span>
                  <span {...stylex.props(styles.quiet)}>{format(m.uploadRule)}</span>
                </Dropzone>
              </div>
            )}

            {at === 1 && uploaded !== null && (
              <div {...stylex.props(styles.stack)}>
                <div {...stylex.props(styles.row)}>
                  <FileTile name={uploaded.filename} />
                  <span {...stylex.props(styles.spacer)} />
                  <Button variant="ghost" size="sm" onClick={restart}>
                    {format(m.replaceFile)}
                  </Button>
                </div>
                <div {...stylex.props(styles.grid2)}>
                  <Field label={format(m.sheetLabel)}>
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
                  <Field label={format(m.headerRowLabel)} hint={format(m.headerRowHint)}>
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
                  error={inspect.isError ? formatError(inspect.error) : null}
                  loadingLabel={format(m.checking)}
                  retryLabel={format(m.retry)}
                  onRetry={() => void inspect.refetch()}
                >
                  {table !== undefined && (
                    <div {...stylex.props(styles.stack)}>
                      <div {...stylex.props(styles.row)}>
                        <p {...stylex.props(styles.sectionTitle)}>{format(m.sampleTitle)}</p>
                        <Badge variant="secondary">{format(m.rowCount, { count: table.rowCount })}</Badge>
                      </div>
                      {headers.length === 0 ? (
                        <Feedback message={format(m.noHeaders)} />
                      ) : (
                        <div {...stylex.props(styles.sample)}>
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
                              {table.sample.map((row) => (
                                <tr key={row.rowNo}>
                                  {headers.map((header) => (
                                    <td key={header.column} {...stylex.props(styles.td)}>
                                      {row.cells[header.column] ?? ''}
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
                <div {...stylex.props(styles.row)}>
                  <span {...stylex.props(styles.spacer)} />
                  <Button disabled={table === undefined || headers.length === 0} onClick={() => setAt(2)}>
                    {format(m.stepMapping)}
                  </Button>
                </div>
              </div>
            )}

            {at === 2 && (
              <div {...stylex.props(styles.stack)}>
                <div {...stylex.props(styles.grid2)}>
                  <ColumnChoice
                    label={format(m.displayNameLabel)}
                    value={displayNameColumn}
                    headers={headers}
                    onChange={setDisplayNameColumn}
                  />
                  <ColumnChoice
                    label={businessNo}
                    value={businessNoColumn}
                    headers={headers}
                    onChange={setBusinessNoColumn}
                  />
                  <Field label={format(m.userTypeLabel)} hint={format(m.userTypeHint)}>
                    {(id) => (
                      <Select value={userTypeId === '' ? undefined : userTypeId} onValueChange={setUserTypeId}>
                        <SelectTrigger id={id}>
                          <SelectValue placeholder={format(m.userTypeUnset)} />
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

                <p {...stylex.props(styles.sectionTitle)}>{format(m.organizationTitle)}</p>
                <Field label={format(m.anchorLabel)} hint={format(m.anchorHint)}>
                  {() => (
                    <div {...stylex.props(styles.picker)}>
                      <UiSlot
                        token={orgNodePicker}
                        context={
                          {
                            value: anchor === null ? [] : [anchor],
                            onChange: (ids) => setAnchor(ids[0] ?? null),
                            single: true,
                          } satisfies OrgNodePickerContext
                        }
                        fallback={<Feedback message={format(m.anchorRoot)} />}
                      />
                    </div>
                  )}
                </Field>
                <Field label={format(m.levelsLabel)} hint={format(m.levelsHint)}>
                  {() => (
                    <div {...stylex.props(styles.stack)}>
                      {levels.map((level) => (
                        <div key={level.key} {...stylex.props(styles.level)}>
                          <Select
                            value={level.orgTypeId === '' ? undefined : level.orgTypeId}
                            onValueChange={(next) =>
                              setLevels((current) =>
                                current.map((one) => (one.key === level.key ? { ...one, orgTypeId: next } : one)),
                              )
                            }
                          >
                            <SelectTrigger aria-label={format(m.levelType)}>
                              <SelectValue placeholder={format(m.levelTypeUnset)} />
                            </SelectTrigger>
                            <SelectContent>
                              {nonRootTypes.map((type) => (
                                <SelectItem key={type.id} value={type.id}>
                                  {type.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={level.column === '' ? undefined : level.column}
                            onValueChange={(next) =>
                              setLevels((current) =>
                                current.map((one) => (one.key === level.key ? { ...one, column: next } : one)),
                              )
                            }
                          >
                            <SelectTrigger aria-label={format(m.columnUnset)}>
                              <SelectValue placeholder={format(m.columnUnset)} />
                            </SelectTrigger>
                            <SelectContent>
                              {headers.map((header) => (
                                <SelectItem key={header.column} value={header.column}>
                                  {header.text}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={format(m.removeLevel)}
                            onClick={() => setLevels((current) => current.filter((one) => one.key !== level.key))}
                          >
                            <XIcon aria-hidden />
                          </Button>
                        </div>
                      ))}
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setLevels((current) => [...current, { key: Date.now(), orgTypeId: '', column: '' }])
                          }
                        >
                          <PlusIcon aria-hidden />
                          {format(m.addLevel)}
                        </Button>
                      </div>
                    </div>
                  )}
                </Field>
                <div {...stylex.props(styles.row)}>
                  <Button variant="ghost" onClick={() => setAt(1)}>
                    {format(m.stepSheet)}
                  </Button>
                  <span {...stylex.props(styles.spacer)} />
                  <Button disabled={!mappingReady || checking.isPending} onClick={() => checking.mutate()}>
                    {checking.isPending && <Spinner />}
                    {format(checking.isPending ? m.checking : m.check)}
                  </Button>
                </div>
              </div>
            )}

            {at === 3 && preview !== null && (
              <div {...stylex.props(styles.stack)} data-testid="import-preview" data-errors={preview.users.errors}>
                <p {...stylex.props(styles.sectionTitle)}>{format(m.previewTitle)}</p>
                <div {...stylex.props(styles.summary)}>
                  <div {...stylex.props(styles.summaryCell)}>
                    <span {...stylex.props(styles.summaryLabel)}>{format(m.previewChain)}</span>
                    <span {...stylex.props(styles.summaryValue)}>
                      {preview.chain
                        .map((level) =>
                          level.source === 'column'
                            ? format(m.chainLevelColumn, { type: level.orgTypeName, column: level.detail })
                            : level.detail,
                        )
                        .join(' / ')}
                    </span>
                  </div>
                  <div {...stylex.props(styles.summaryCell)}>
                    <span {...stylex.props(styles.summaryLabel)}>{format(m.previewNodesLabel)}</span>
                    <span {...stylex.props(styles.summaryValue)}>
                      {format(m.previewNodes, { reused: preview.nodes.reused, created: preview.nodes.created })}
                    </span>
                  </div>
                  <div {...stylex.props(styles.summaryCell)}>
                    <span {...stylex.props(styles.summaryLabel)}>{format(m.previewUsersLabel)}</span>
                    <span {...stylex.props(styles.summaryValue)}>
                      {format(m.previewUsers, { create: preview.users.create, existing: preview.users.existing })}
                    </span>
                  </div>
                </div>
                {preview.users.errors === 0 ? (
                  <p {...stylex.props(styles.quiet, styles.ok)}>{format(m.previewClean)}</p>
                ) : (
                  <div {...stylex.props(styles.stack)}>
                    <p {...stylex.props(styles.sectionTitle, styles.bad)}>
                      {format(m.previewErrors, { count: preview.users.errors })}
                    </p>
                    <p {...stylex.props(styles.quiet)}>{format(m.previewIssuesHint)}</p>
                    <ul {...stylex.props(styles.list)} data-testid="import-issues">
                      {preview.issues
                        .slice((issuePage - 1) * ISSUES_PER_PAGE, issuePage * ISSUES_PER_PAGE)
                        .map((issue, index) => (
                        <li key={index}>
                          {issue.rowNo === null ? format(m.issueFile) : format(m.issueRow, { row: issue.rowNo })}
                          {' '}
                          {issueText(format, issue, businessNo)}
                        </li>
                      ))}
                    </ul>
                    <div {...stylex.props(styles.issuePager)}>
                      <Pager
                        testId="import-issues-pager"
                        label={format(m.pagerLabel)}
                        page={issuePage}
                        pageSize={ISSUES_PER_PAGE}
                        total={preview.issues.length}
                        onPage={setIssuePage}
                      />
                    </div>
                  </div>
                )}
                {preview.createdNodes.length > 0 && (
                  <div {...stylex.props(styles.stack)}>
                    <p {...stylex.props(styles.sectionTitle)}>{format(m.previewCreatedNodes)}</p>
                    <ul {...stylex.props(styles.list)}>
                      {preview.createdNodes.map((path) => (
                        <li key={path}>{path}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div {...stylex.props(styles.row)}>
                  <Button variant="ghost" onClick={() => setAt(2)}>
                    {format(m.stepMapping)}
                  </Button>
                  <span {...stylex.props(styles.spacer)} />
                  <Button
                    disabled={preview.users.errors > 0 || committing.isPending}
                    onClick={() => committing.mutate()}
                  >
                    {committing.isPending && <Spinner />}
                    {format(committing.isPending ? m.committing : m.commit)}
                  </Button>
                </div>
              </div>
            )}

            {at === 4 && done !== null && (
              <div {...stylex.props(styles.stack)} data-testid="import-done">
                <p {...stylex.props(styles.sectionTitle)}>{format(m.doneTitle)}</p>
                <p {...stylex.props(styles.quiet)}>
                  {format(m.done, { users: done.createdUsers, nodes: done.createdNodes })}
                </p>
                <div {...stylex.props(styles.row)}>
                  <Button onClick={() => onOpenRecord(done.importId)}>{format(m.openRecord)}</Button>
                  <Button variant="outline" onClick={restart}>
                    {format(m.importAnother)}
                  </Button>
                </div>
              </div>
            )}
          </div>
  )
}

function ColumnChoice({
  label,
  value,
  headers,
  onChange,
}: {
  label: string
  value: string
  headers: Inspect['table']['headers']
  onChange: (column: string) => void
}) {
  const { format } = useI18n()
  return (
    <Field label={label}>
      {(id) => (
        <Select value={value === '' ? undefined : value} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={format(m.columnUnset)} />
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
}

/** what was imported before, newest first, each a way into its record */
/** problems of a checked file to a page */
const ISSUES_PER_PAGE = 10

/** imports to a page of the record list */
const RECORDS_PER_PAGE = 10

/**
 * What has been imported before, newest first, a page at a time; a row opens
 * its record beside whatever frames this list.
 */
export function ImportRecords({ onOpen }: { onOpen: (importId: string) => void }) {
  const { format, formatError, locale } = useI18n()
  const query = useApiQuery(directoryApi)
  const [page, setPage] = useState(1)
  const imports = useQuery({
    ...query.directory.listUserImports.queryOptions({
      query: { page: String(page), limit: String(RECORDS_PER_PAGE) },
    }),
    placeholderData: keepPreviousData,
  })
  const items = imports.data?.items ?? []
  return (
    // A fixed seat, the design's own rule: a page of ten rows and a page of
    // one must be the same height, or a modal that is read by paging jumps
    // under the reader's hand every time they turn a page.
    <Card data-testid="import-records" xstyle={styles.recordsSeat}>
      <AsyncSection
        pending={imports.isPending}
        error={imports.isError ? formatError(imports.error) : null}
        loadingLabel={format(m.recordsLoading)}
        retryLabel={format(m.retry)}
        onRetry={() => void imports.refetch()}
      >
        {items.length === 0 ? (
          <CardEmpty>{format(m.recordsEmpty)}</CardEmpty>
        ) : (
          <Table columns="minmax(0, 1.3fr) minmax(0, 1.4fr) 6rem 8.5rem" openable>
            <TableHead>
              <span>{format(m.recordFile)}</span>
              <span>{format(m.recordOutcome)}</span>
              <span>{format(m.recordBy)}</span>
              <span>{format(m.recordAt)}</span>
            </TableHead>
            {items.map((one) => (
              <TableRow
                key={one.id}
                onOpen={() => onOpen(one.id)}
                data-testid="import-record"
                data-import={one.id}
                data-living={one.standing.living}
              >
                <Cell lead title={one.filename}>
                  <LeadWord>{one.filename}</LeadWord>
                  {one.standing.living === 0 && one.createdUserCount > 0 && (
                    <Tag outline>{format(m.recordReversed)}</Tag>
                  )}
                </Cell>
                <Cell>
                  {format(m.recordCounts, {
                    users: one.createdUserCount,
                    existing: one.existingUserCount,
                    nodes: one.createdNodeCount,
                  })}
                </Cell>
                <Cell>{one.actorName ?? '—'}</Cell>
                <Cell numeric>{whenText(locale, one.createdAt)}</Cell>
              </TableRow>
            ))}
          </Table>
        )}
        <CardFoot>
          <Pager
            testId="import-records-pager"
            label={format(m.pagerLabel)}
            page={imports.data?.page ?? page}
            pageSize={RECORDS_PER_PAGE}
            total={imports.data?.total ?? 0}
            disabled={imports.isFetching}
            summary={format(m.countOf, { count: imports.data?.total ?? 0 })}
            onPage={setPage}
          />
        </CardFoot>
      </AsyncSection>
    </Card>
  )
}
