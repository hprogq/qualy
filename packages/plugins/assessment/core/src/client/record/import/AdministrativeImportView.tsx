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
import { Skeleton } from '@qualy/ui/skeleton'
import { Spinner } from '@qualy/ui/spinner'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi, assessmentUrls } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { administrativeItemsOf, fieldsOf, sizeLabel, type ItemDto } from '../../entry/model.ts'
import { uploadFile } from '../../entry/upload.ts'
import { ChosenItem, ItemPicker } from '../ItemPicker.tsx'
import {
  NoAdministrativeItems,
  RecordColumn,
  RecordSheet,
  SheetBlock,
  SheetLead,
} from '../sheet.tsx'
import { fieldText, reasonText, type ColumnNames, type ImportIssue } from './issues.ts'

// A workbook of administrative facts, taken in.
//
// Three things in order, all on one sheet: which question, the filled-in
// file, and what the server made of it. Nothing is written until the last
// press, and that press is only offered once the server - having read the
// stored file itself - found nothing wrong. Warnings do not stop it; they
// have to be looked at, which is what the box beside the button is for.
//
// Which question comes first and alone, because the file's very columns
// come from it. The template block is then the first thing on the sheet
// rather than a footnote, because a file that was never the template is
// refused whole - and being told that after filling in a hundred rows is
// being told too late. Which is also why the refusal, when it comes,
// carries the download rather than only naming what went wrong: the way out
// is the same press either way.
//
// It is one form, in order, not a wizard. Changing the question is the one
// way back, and it is a way back to the choice rather than to a step: a
// different question is a different file, so nothing already here survives
// it.
//
// Big files do not spread out here. The result opens on the rows that need
// attention, and the whole list is one press away.

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const wide = '@media (min-width: 900px)'

const styles = stylex.create({
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  step: { display: 'flex', flexDirection: 'column', gap: 8 },
  stepHead: { display: 'flex', alignItems: 'center', gap: 10 },
  // a numbered order, because the first one is a gate: a file that was never
  // the template is refused whole, and being told that after filling in a
  // hundred rows is being told too late
  stepMark: {
    display: 'inline-flex',
    flexShrink: 0,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  stepTitle: { fontSize: 14, fontWeight: 600 },
  stepBody: { display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 32 },
  templateBox: {
    display: 'flex',
    gap: 12,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
    padding: 12,
  },
  templateSeat: {
    display: 'flex',
    flexShrink: 0,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surface,
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
    color: tokens.surfaceMutedForeground,
  },
  templateBody: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 8 },
  templateTitle: { fontSize: 13, fontWeight: 600 },
  templateText: { fontSize: 12, lineHeight: 1.65, color: tokens.mutedForeground },
  templateRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  templateNote: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  icon: { width: 14, height: 14 },
  seatIcon: { width: 16, height: 16 },
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
  tally: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: { default: 6, [wide]: 12 },
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  // Wide, the tally is a sentence to read across. Narrow, the three counts
  // that carry a verdict become blocks that can be told apart at a glance,
  // because on a phone they wrap into a stack and a stack of identical grey
  // numbers is the one shape that hides which of them is the bad news.
  tallyPart: {
    borderRadius: { default: tokens.radiusSm, [wide]: 0 },
    paddingInline: { default: 8, [wide]: 0 },
    paddingBlock: { default: 3, [wide]: 0 },
    backgroundColor: { default: tokens.surfaceInset, [wide]: 'transparent' },
  },
  tallyGood: {
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.success} 14%, transparent)`,
      [wide]: 'transparent',
    },
    color: { default: tokens.successForeground, [wide]: tokens.mutedForeground },
  },
  tallyCheck: {
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.warning} 16%, transparent)`,
      [wide]: 'transparent',
    },
    color: { default: tokens.warningForeground, [wide]: tokens.mutedForeground },
  },
  tallyBad: {
    color: tokens.danger,
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.danger} 12%, transparent)`,
      [wide]: 'transparent',
    },
  },
  table: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  // wide, four columns a reader scans down; narrow, the same four facts as a
  // card per row, because a 6rem name column on a phone is a column of
  // ellipses
  row: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'auto auto minmax(0, 1fr)',
      [wide]: '3.5rem minmax(0, 7rem) minmax(0, 6rem) minmax(0, 1fr)',
    },
    columnGap: 12,
    rowGap: 4,
    alignItems: 'start',
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingBlock: 8,
    fontSize: 13,
    lineHeight: '1.25rem',
  },
  head: {
    display: { default: 'none', [wide]: 'grid' },
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  rowNo: {
    gridColumnStart: 1,
    gridRowStart: 1,
    color: { default: tokens.mutedForeground, [wide]: 'inherit' },
    fontVariantNumeric: 'tabular-nums',
  },
  // the number identifies the row in the file; the name is what a reader
  // recognises, so narrow puts the name first
  numberCell: {
    gridColumnStart: { default: 3, [wide]: 2 },
    gridRowStart: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: { default: tokens.mutedForeground, [wide]: 'inherit' },
    fontVariantNumeric: 'tabular-nums',
  },
  nameCell: {
    gridColumnStart: { default: 2, [wide]: 3 },
    gridRowStart: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: { default: 500, [wide]: 400 },
  },
  issues: {
    gridColumn: { default: '1 / span 3', [wide]: '4' },
    gridRowStart: { default: 2, [wide]: 1 },
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
  },
  issue: { display: 'flex', alignItems: 'baseline', gap: 6 },
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

  const administrative = administrativeItemsOf((items.data?.items ?? []) as readonly ItemDto[])
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
        queryKey: query.assessment.listAdministrativeEntries.key({
          params: { batchId },
          query: {},
        }),
      })
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeImports.key({
          params: { batchId },
          query: {},
        }),
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
        <NoAdministrativeItems />
      ) : (
        <RecordColumn testId="administrative-import">
          {item === null ? (
            <>
              <SheetLead>{format(m.importItemPick)}</SheetLead>
              <ItemPicker batchId={batchId} items={administrative} onPick={choose} />
            </>
          ) : (
            <>
              <ChosenItem batchId={batchId} item={item} onChange={() => choose('')} />
              <RecordSheet>
                <SheetBlock>
                  <div {...stylex.props(styles.step)}>
                    <span {...stylex.props(styles.stepHead)}>
                      <span aria-hidden {...stylex.props(styles.stepMark)}>
                        1
                      </span>
                      <span {...stylex.props(styles.stepTitle)}>
                        {format(m.importTemplateTitle)}
                      </span>
                    </span>
                    <span {...stylex.props(styles.stepBody)}>
                      <span {...stylex.props(styles.templateText)}>
                        {format(m.importTemplateHint)}
                      </span>
                      <span {...stylex.props(styles.templateRow)}>
                        <TemplateDownload item={item} />
                        <span {...stylex.props(styles.templateNote)}>
                          {format(m.importTemplateRefresh)}
                        </span>
                      </span>
                    </span>
                  </div>

                  <div {...stylex.props(styles.step)}>
                    <span {...stylex.props(styles.stepHead)}>
                      <span aria-hidden {...stylex.props(styles.stepMark)}>
                        2
                      </span>
                      <span {...stylex.props(styles.stepTitle)}>{format(m.importFile)}</span>
                    </span>
                    <span {...stylex.props(styles.stepBody)}>
                      <Field label={format(m.importFile)} hideLabel hint={format(m.importFileHint)}>
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
                                <FileSpreadsheetIcon
                                  aria-hidden
                                  {...stylex.props(styles.tileIcon)}
                                />
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
                    </span>
                  </div>

                  <div {...stylex.props(styles.step)}>
                    <span {...stylex.props(styles.stepHead)}>
                      <span aria-hidden {...stylex.props(styles.stepMark)}>
                        3
                      </span>
                      <span {...stylex.props(styles.stepTitle)}>
                        {format(m.importDefaultBasis)}
                      </span>
                    </span>
                    <span {...stylex.props(styles.stepBody)}>
                      <Field
                        label={format(m.importDefaultBasis)}
                        hideLabel
                        hint={format(m.importDefaultBasisHint)}
                      >
                        {(id) => (
                          <Input
                            id={id}
                            value={basis}
                            onChange={(event) => setBasis(event.target.value)}
                          />
                        )}
                      </Field>
                    </span>
                  </div>
                </SheetBlock>
              </RecordSheet>

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
                  {/* the way out, beside what is wrong: every refusal at this
                  level is answered by starting from the template again */}
                  <div {...stylex.props(styles.templateRow)}>
                    <TemplateDownload item={item} />
                    <span {...stylex.props(styles.templateNote)}>
                      {format(m.importRefusedHint)}
                    </span>
                  </div>
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
                      {/* the total is context, not a verdict, so it stays
                          plain at every width */}
                      <span>{format(m.importSummaryRows, { count: preview.summary.rows })}</span>
                      <span {...stylex.props(styles.tallyPart, styles.tallyGood)}>
                        {format(m.importSummaryValid, { count: preview.summary.valid })}
                      </span>
                      {preview.summary.warnings > 0 && (
                        <span {...stylex.props(styles.tallyPart, styles.tallyCheck)}>
                          {format(m.importSummaryWarnings, { count: preview.summary.warnings })}
                        </span>
                      )}
                      {preview.summary.errors > 0 && (
                        <span {...stylex.props(styles.tallyPart, styles.tallyBad)}>
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
                          <span role="cell" {...stylex.props(styles.rowNo)}>
                            {row.rowNo}
                          </span>
                          <span role="cell" {...stylex.props(styles.numberCell)}>
                            {row.businessNo}
                          </span>
                          <span role="cell" {...stylex.props(styles.nameCell)}>
                            {row.matchedParticipant?.displayName ?? row.displayNameFromFile}
                          </span>
                          <span role="cell" {...stylex.props(styles.issues)}>
                            {/* a row with nothing to check says nothing: the
                            column is about what needs a look */}
                            {row.issues.length === 0
                              ? null
                              : row.issues.map((issue, at) => {
                                  const where = fieldText(format, issue.field, names)
                                  return (
                                    <span key={at} {...stylex.props(styles.issue)}>
                                      <Badge
                                        variant={
                                          issue.severity === 'error' ? 'destructive' : 'outline'
                                        }
                                      >
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
                                })}
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
            </>
          )}
        </RecordColumn>
      )}
    </AsyncSection>
  )
}

/** the one press that answers "where do I get the right file" */
function TemplateDownload({ item }: { item: ItemDto }) {
  const { format } = useI18n()
  return (
    <Button asChild variant="outline" size="sm">
      <a
        href={assessmentUrls.assessment.administrativeImportTemplate({
          params: { itemId: item.id },
        })}
        download
        data-testid="import-template"
      >
        <DownloadIcon aria-hidden {...stylex.props(styles.icon)} />
        {format(m.importTemplate, { item: item.title })}
      </a>
    </Button>
  )
}
