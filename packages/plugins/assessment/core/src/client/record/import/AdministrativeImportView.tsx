import { useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, FileSpreadsheetIcon } from 'lucide-react'
import { displayTitle, type AtomicSchema } from '@qualy/value-schema'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Field } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Dropzone, FileTile } from '@qualy/ui/dropzone'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { Skeleton } from '@qualy/ui/skeleton'
import { Spinner } from '@qualy/ui/spinner'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi, assessmentUrls } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { fieldsOf, sizeLabel, type ItemDto } from '../../entry/model.ts'
import { uploadFile } from '../../entry/upload.ts'
import { fieldText, reasonText, type ColumnNames, type ImportIssue } from './issues.ts'

// A workbook of administrative facts, taken in.
//
// Three things in order, all on one sheet: which question, the filled-in
// file, and what the server made of it. Nothing is written until the last
// press, and that press is only offered once the server - having read the
// stored file itself - found nothing wrong. Warnings do not stop it; they
// have to be looked at, which is what the box beside the button is for.
//
// Big files do not spread out here. The result opens on the rows that need
// attention, and the whole list is one press away.

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const styles = stylex.create({
  column: { display: 'flex', maxWidth: '48rem', flexDirection: 'column', gap: 20 },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  hint: { fontSize: 12, lineHeight: '1rem', color: tokens.mutedForeground },
  templateRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  icon: { width: 14, height: 14 },
  tileIcon: { width: 18, height: 18 },
  waiting: { height: 160, width: '100%' },
  result: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    padding: 16,
  },
  resultHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 },
  resultTitle: { fontSize: 14, fontWeight: 600 },
  tally: { display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13, color: tokens.mutedForeground },
  tallyBad: { color: tokens.danger },
  table: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  row: {
    display: 'grid',
    gridTemplateColumns: '3.5rem minmax(0, 7rem) minmax(0, 6rem) minmax(0, 1fr)',
    columnGap: 12,
    alignItems: 'start',
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingBlock: 8,
    fontSize: 13,
    lineHeight: '1.25rem',
  },
  head: { fontSize: 12, color: tokens.mutedForeground },
  cell: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  issues: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
  issue: { display: 'flex', alignItems: 'baseline', gap: 6 },
  fine: { color: tokens.mutedForeground },
  fileIssues: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 },
  foot: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  spacer: { flexGrow: 1 },
  confirm: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
})

interface Uploaded {
  readonly attachmentId: string
  readonly filename: string
  readonly size: string
}

export function AdministrativeImportView({
  batchId,
  onImported,
}: {
  batchId: string
  onImported: (importId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))

  const [itemId, setItemId] = useState('')
  const [uploaded, setUploaded] = useState<Uploaded | null>(null)
  const [basis, setBasis] = useState('')
  const [checkedBasis, setCheckedBasis] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const administrative = ((items.data?.items ?? []) as readonly ItemDto[]).filter(
    (item) => item.status === 'active' && item.currentRevision?.entrySource === 'administrative',
  )
  const item = administrative.find((candidate) => candidate.id === itemId) ?? null
  const revisionId = item?.currentRevision?.id ?? ''

  const contract = useQuery({
    ...query.assessment.getRecognitionContract.queryOptions({ params: { itemId } }),
    enabled: itemId !== '',
  })
  // the headers the reader filled in, for naming the cell a problem is in
  const names: ColumnNames = useMemo(
    () => ({
      evidence: new Map(
        fieldsOf(item?.currentRevision?.formConfig).map((field) => [field.key, field.label]),
      ),
      recognition: new Map(
        (contract.data?.contract?.fields ?? []).map((field) => [
          field.id,
          displayTitle(field.schema as AtomicSchema, field.id, locale),
        ]),
      ),
    }),
    [item, contract.data, locale],
  )

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadFile(
        {
          prepare: (input) =>
            run(
              api.assessment.prepareAdministrativeImportUpload({
                params: { batchId },
                payload: {
                  itemId: input.itemId,
                  filename: input.filename,
                  declaredMime: input.declaredMime,
                  size: input.size,
                },
              }),
            ),
          complete: (reservationId) =>
            run(api.assessment.completeAdministrativeImportUpload({ params: { reservationId } })),
        },
        { batchId, itemId },
        file,
      ),
    onSuccess: (file) => {
      setUploaded(file)
      check.mutate({ attachmentId: file.attachmentId, basis })
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const check = useMutation({
    mutationFn: (input: { attachmentId: string; basis: string }) =>
      run(
        api.assessment.previewAdministrativeImport({
          params: { batchId },
          payload: {
            attachmentId: input.attachmentId,
            itemId,
            expectedItemRevisionId: revisionId,
            ...(input.basis.trim() === '' ? {} : { defaultBasis: input.basis.trim() }),
          },
        }),
      ),
    onMutate: (input) => {
      setCheckedBasis(input.basis)
      setConfirmed(false)
      setShowAll(false)
    },
  })

  const commit = useMutation({
    mutationFn: () =>
      run(
        api.assessment.commitAdministrativeImport({
          params: { batchId },
          payload: {
            attachmentId: uploaded!.attachmentId,
            itemId,
            expectedItemRevisionId: revisionId,
            ...(basis.trim() === '' ? {} : { defaultBasis: basis.trim() }),
            confirmWarnings: confirmed,
          },
        }),
      ),
    onSuccess: (done) => {
      toast.success(format(m.importDone, { count: done.importedCount }))
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeEntries.key({ params: { batchId }, query: {} }),
      })
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeImports.key({ params: { batchId }, query: {} }),
      })
      onImported(done.importId)
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const choose = (next: string) => {
    // a file is filled in against one question; another question is another file
    setItemId(next)
    setUploaded(null)
    check.reset()
  }

  const preview = check.data ?? null
  // what the server refused about the file as a whole, before any row
  const refusal = (() => {
    const error = check.error as { _tag?: string; issues?: readonly ImportIssue[] } | null
    if (error === null) return null
    if (error._tag === 'ASSESSMENT_ADMINISTRATIVE_IMPORT_INVALID' && error.issues !== undefined) {
      return { issues: error.issues, sentence: null }
    }
    return { issues: [] as readonly ImportIssue[], sentence: formatError(check.error) }
  })()
  const stale = preview !== null && checkedBasis !== basis
  const flagged = (preview?.rows ?? []).filter((row) => row.issues.length > 0)
  const shown = showAll ? (preview?.rows ?? []) : flagged
  const ready =
    preview !== null &&
    preview.canCommit &&
    !stale &&
    (preview.summary.warnings === 0 || confirmed) &&
    !commit.isPending

  return (
    <AsyncSection
      pending={items.isPending}
      error={items.error ? formatError(items.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void items.refetch()}
      skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
    >
      {administrative.length === 0 ? (
        <p {...stylex.props(styles.quiet)}>{format(m.recordEmpty)}</p>
      ) : (
        <div {...stylex.props(styles.column)} data-testid="administrative-import">
          <Field label={format(m.recordItem)} hint={format(m.importItemHint)}>
            {(id) => (
              <NativeSelect id={id} value={itemId} onChange={(event) => choose(event.target.value)}>
                <option value="" />
                {administrative.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>

          {item !== null && (
            <>
              <div {...stylex.props(styles.templateRow)}>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={assessmentUrls.assessment.administrativeImportTemplate({
                      params: { itemId: item.id },
                    })}
                    download
                    data-testid="import-template"
                  >
                    <DownloadIcon aria-hidden {...stylex.props(styles.icon)} />
                    {format(m.importTemplate)}
                  </a>
                </Button>
                <span {...stylex.props(styles.hint)}>{format(m.importTemplateHint)}</span>
              </div>

              <Field label={format(m.importFile)} hint={format(m.importFileHint)}>
                {() =>
                  uploaded === null ? (
                    <Dropzone
                      accept={{ [XLSX]: ['.xlsx'] }}
                      maxFiles={1}
                      multiple={false}
                      disabled={upload.isPending}
                      onFiles={(files) => {
                        const file = files[0]
                        if (file !== undefined) upload.mutate(file)
                      }}
                    >
                      {upload.isPending ? (
                        <>
                          <Spinner />
                          {format(m.importUploading)}
                        </>
                      ) : (
                        format(m.importChooseFile)
                      )}
                    </Dropzone>
                  ) : (
                    <FileTile
                      media={
                        <FileSpreadsheetIcon aria-hidden {...stylex.props(styles.tileIcon)} />
                      }
                      name={uploaded.filename}
                      meta={sizeLabel(Number(uploaded.size))}
                      actions={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setUploaded(null)
                            check.reset()
                          }}
                        >
                          {format(m.importChooseAnother)}
                        </Button>
                      }
                    />
                  )
                }
              </Field>

              <Field label={format(m.importDefaultBasis)} hint={format(m.importDefaultBasisHint)}>
                {(id) => (
                  <Input id={id} value={basis} onChange={(event) => setBasis(event.target.value)} />
                )}
              </Field>
            </>
          )}

          {uploaded !== null && check.isPending && (
            <p {...stylex.props(styles.quiet)}>{format(m.importChecking)}</p>
          )}

          {uploaded !== null && refusal !== null && (
            <div {...stylex.props(styles.result)} data-testid="import-refused">
              <p {...stylex.props(styles.resultTitle)}>{format(m.importFileUnreadable)}</p>
              {refusal.sentence !== null ? (
                <p {...stylex.props(styles.quiet)}>{refusal.sentence}</p>
              ) : (
                <div {...stylex.props(styles.fileIssues)}>
                  {refusal.issues.map((issue, at) => (
                    <span key={at} data-reason={issue.reason}>
                      {reasonText(format, issue)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {uploaded !== null && preview !== null && (
            <div
              {...stylex.props(styles.result)}
              data-testid="import-preview"
              data-rows={preview.summary.rows}
              data-errors={preview.summary.errors}
              data-warnings={preview.summary.warnings}
            >
              <div {...stylex.props(styles.resultHead)}>
                <p {...stylex.props(styles.resultTitle)}>{format(m.importResult)}</p>
                <span {...stylex.props(styles.tally)}>
                  <span>{format(m.importSummaryRows, { count: preview.summary.rows })}</span>
                  <span>{format(m.importSummaryValid, { count: preview.summary.valid })}</span>
                  {preview.summary.warnings > 0 && (
                    <span>
                      {format(m.importSummaryWarnings, { count: preview.summary.warnings })}
                    </span>
                  )}
                  {preview.summary.errors > 0 && (
                    <span {...stylex.props(styles.tallyBad)}>
                      {format(m.importSummaryErrors, { count: preview.summary.errors })}
                    </span>
                  )}
                </span>
                <span {...stylex.props(styles.spacer)} />
                {stale && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={check.isPending}
                    onClick={() => check.mutate({ attachmentId: uploaded.attachmentId, basis })}
                  >
                    {format(m.importRecheck)}
                  </Button>
                )}
              </div>

              {preview.summary.errors > 0 ? (
                <p {...stylex.props(styles.quiet)}>{format(m.importFixAndRetry)}</p>
              ) : flagged.length === 0 ? (
                <p {...stylex.props(styles.quiet)}>{format(m.importAllReady)}</p>
              ) : null}

              {shown.length > 0 && (
                <div {...stylex.props(styles.table)} role="table">
                  <div role="row" {...stylex.props(styles.row, styles.head)}>
                    <span role="columnheader">{format(m.importColumnRow)}</span>
                    <span role="columnheader">{format(m.importColumnBusinessNo)}</span>
                    <span role="columnheader">{format(m.importColumnName)}</span>
                    <span role="columnheader">{format(m.importColumnIssues)}</span>
                  </div>
                  {shown.map((row) => (
                    <div
                      key={row.rowNo}
                      role="row"
                      data-testid="import-preview-row"
                      data-row={row.rowNo}
                      data-reasons={row.issues.map((one) => one.reason).join(' ')}
                      {...stylex.props(styles.row)}
                    >
                      <span role="cell">{row.rowNo}</span>
                      <span role="cell" {...stylex.props(styles.cell)}>
                        {row.businessNo}
                      </span>
                      <span role="cell" {...stylex.props(styles.cell)}>
                        {row.matchedParticipant?.displayName ?? row.displayNameFromFile}
                      </span>
                      <span role="cell" {...stylex.props(styles.issues)}>
                        {row.issues.length === 0 ? (
                          <span {...stylex.props(styles.fine)}>—</span>
                        ) : (
                          row.issues.map((issue, at) => {
                            const where = fieldText(format, issue.field, names)
                            return (
                              <span key={at} {...stylex.props(styles.issue)}>
                                <Badge variant={issue.severity === 'error' ? 'destructive' : 'outline'}>
                                  {format(
                                    issue.severity === 'error'
                                      ? m.importSeverityError
                                      : m.importSeverityWarning,
                                  )}
                                </Badge>
                                <span>
                                  {where === null
                                    ? reasonText(format, issue)
                                    : format(m.importIssueAt, {
                                        field: where,
                                        reason: reasonText(format, issue),
                                      })}
                                </span>
                              </span>
                            )
                          })
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div {...stylex.props(styles.foot)}>
                {preview.rows.length > flagged.length && (
                  <Button size="sm" variant="ghost" onClick={() => setShowAll((all) => !all)}>
                    {showAll
                      ? format(m.importShowProblems)
                      : format(m.importShowAll, { count: preview.summary.rows })}
                  </Button>
                )}
                <span {...stylex.props(styles.spacer)} />
                {preview.canCommit && preview.summary.warnings > 0 && (
                  <label {...stylex.props(styles.confirm)}>
                    <Checkbox
                      checked={confirmed}
                      onCheckedChange={setConfirmed}
                      data-testid="import-confirm-warnings"
                    />
                    {format(m.importConfirmWarnings)}
                  </label>
                )}
                {preview.canCommit && (
                  <Button
                    disabled={!ready}
                    onClick={() => commit.mutate()}
                    data-testid="import-commit"
                  >
                    {format(m.importCommit, { count: preview.summary.valid })}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </AsyncSection>
  )
}
