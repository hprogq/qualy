import type { Effect } from 'effect'
import {
  assertNever,
  isUseCaseApiFailure,
  formatPlatformFailure as formatError,
  useLocale,
} from '@qualy/web-i18n'

import { useApiMutation, useApi, useApiQuery, useLoadFailure, useRunApi } from '@qualy/web-runtime'
import { useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, FileSpreadsheetIcon } from 'lucide-react'
import { displayTitle, type AtomicSchema } from '@qualy/value-schema'

import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'

import { AsyncSection, Field } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Dropzone, FileTile } from '@qualy/ui/dropzone'
import { Input } from '@qualy/ui/input'
import { Spinner } from '@qualy/ui/spinner'
import { toast } from '@qualy/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi, assessmentUrls } from '../../api.ts'

import { administrativeItemsOf, fieldsOf, sizeLabel, type ItemDto } from '../../entry/model.ts'
import { uploadFile } from '../../entry/upload.ts'
import { sayEntryFailure } from '../../entry/refusals.ts'
import { ItemPicker } from '../ItemPicker.tsx'
import {
  NoAdministrativeItems,
  Wizard,
  WizardBody,
  WizardFoot,
  WizardNotice,
  WizardRail,
  WizardRecap,
  WizardRecapRow,
  WizardSection,
} from '../wizard.tsx'
import { fieldText, reasonText, type ColumnNames, type ImportIssue } from './issues.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// A workbook of administrative facts, taken in.
//
// Three moves, the same three as recording one by hand. Which question comes
// first and alone, because the file's very columns come from it. Then the
// file itself, with the template sitting above the dropzone rather than in a
// footnote: a file that was never the template is refused whole, and being
// told that after filling in a hundred rows is being told too late. Then
// what the server made of it, which is also where the one press that writes
// anything lives.
//
// Nothing is written until that last press, and it is only offered once the
// server - having read the stored file itself - found nothing wrong.
// Warnings do not stop it; they have to be looked at, which is what the box
// beside the button is for.
//
// Going back to the question is a way back to the choice rather than to a
// step: a different question is a different file, so nothing already here
// survives it.
//
// Big files do not spread out here. The result opens on the rows that need
// attention, and the whole list is one press away.

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const wide = '@media (min-width: 900px)'

const styles = stylex.create({
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  fill: { display: 'flex', minHeight: 0, minWidth: 0, flexGrow: 1, flexDirection: 'column' },
  templateRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  templateNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  icon: { width: 14, height: 14 },
  tileIcon: { width: 18, height: 18 },
  // One seat, three states. Empty, uploading and holding a file are the
  // same box at the same height - a step whose middle jumps every time the
  // file moves reads as three different screens - and that height is the
  // one the finished state needs, not a roomier one it rattles around in.
  seat: { display: 'flex', flexDirection: 'column' },
  // Its own height, but not its own crowding. The padding goes because the
  // area centres a column whose first item is the file input, and the space
  // it leaves after that pushes the words below the middle of a box with a
  // height of its own. The GAP is not that space - it is what stands between
  // the mark and the file's name, and zeroing it put them together.
  seatBox: { height: 58, paddingBlock: 0 },
  // The empty area centres a column whose first item is the file input, and
  // the gap it would leave after it pushes the words below the middle of a
  // box with a height of its own. The TILE's gap is a different thing - it
  // is what stands between the mark and the file's name - so only the area
  // gives its up.
  seatEmpty: { gap: 0 },
  uploading: { display: 'flex', alignItems: 'center', gap: 8 },
  refused: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 6%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.danger} 28%, transparent)`,
    paddingInline: 14,
    paddingBlock: 12,
  },
  refusedTitle: { fontSize: 13, fontWeight: 600, color: tokens.danger },
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
    backgroundColor: tokens.surfaceInset,
    paddingInline: 10,
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
  rowsHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
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
  const locale = useLocale()
  const failures = useLoadFailure()
  const businessNo = useTerm(authTerms.businessNumber)
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))

  const [itemId, setItemId] = useState('')
  const [at, setAt] = useState(0)
  const [uploaded, setUploaded] = useState<Uploaded | null>(null)
  const [basis, setBasis] = useState('')
  const [checkedBasis, setCheckedBasis] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const administrative = administrativeItemsOf(items.data?.items ?? [])
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
    onSuccess: (file) => setUploaded(file),
    onError: (error) => toast.error(sayEntryFailure(error, { formatError })),
  })

  // Preview and commit explain the same file-level refusals. Uploading keeps
  // its separate transport workflow and entry-action semantics.
  const importFailure = (
    error: Effect.Error<
      ReturnType<
        | typeof api.assessment.previewAdministrativeImport
        | typeof api.assessment.commitAdministrativeImport
      >
    >,
  ) => {
    if (!isUseCaseApiFailure(error)) return formatError(error)
    switch (error._tag) {
      case 'ASSESSMENT_ADMINISTRATIVE_IMPORT_BUSY':
        return m.error_administrativeImportBusy()
      case 'ASSESSMENT_ADMINISTRATIVE_IMPORT_INVALID':
        return m.error_administrativeImportInvalid()
      case 'ASSESSMENT_BATCH_NOT_FOUND':
        return m.error_batchNotFound()
      case 'ASSESSMENT_BATCH_READ_ONLY':
        return m.error_batchReadOnly()
      case 'ASSESSMENT_ITEM_NOT_FOUND':
        return m.error_itemNotFound()
      case 'ASSESSMENT_ITEM_REVISION_CONFLICT':
        return m.error_itemRevisionConflict()
      case 'ASSESSMENT_SCORING_UNAVAILABLE':
        return m.error_scoringUnavailable()
      case 'ASSESSMENT_ATTACHMENT_NOT_FOUND':
        return m.error_attachmentNotFound()
      case 'ASSESSMENT_DETERMINATION_REFUSED':
        return m.error_determinationRefused({ reason: error.reason })
      case 'ASSESSMENT_ENTRY_ACTION_REFUSED':
        return sayEntryFailure(error, { formatError })
      default:
        return assertNever(error)
    }
  }

  const check = useApiMutation({
    mutationFn: (input: { attachmentId: string; basis: string }) =>
      api.assessment.previewAdministrativeImport({
        params: { batchId },
        payload: {
          attachmentId: input.attachmentId,
          itemId,
          expectedItemRevisionId: revisionId,
          ...(input.basis.trim() === '' ? {} : { defaultBasis: input.basis.trim() }),
        },
      }),
    onMutate: (input) => {
      setCheckedBasis(input.basis)
      setConfirmed(false)
      setShowAll(false)
    },
    // a file the server would not read is answered back on the step that
    // holds the dropzone: the way out is another file, not another press
    onSuccess: () => setAt(2),
    onError: () => setAt(1),
  })

  const commit = useApiMutation({
    mutationFn: () =>
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
    onSuccess: (done) => {
      toast.success(m.record_import_done({ count: done.importedCount }))
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
    onError: (error) => toast.error(importFailure(error)),
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
    return {
      issues: [] as readonly ImportIssue[],
      sentence: importFailure(check.error!),
    }
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

  const steps = [m.record_stepItem(), m.record_import_stepFile(), m.record_import_stepConfirm()]

  return (
    <AsyncSection
      pending={items.isPending}
      error={items.isError ? failures.of(items.error) : null}
      loadingLabel={commonMessages.state_loading()}
      retryLabel={commonMessages.action_retry()}
      onRetry={() => void items.refetch()}
      xstyle={styles.fill}
    >
      {administrative.length === 0 ? (
        <NoAdministrativeItems />
      ) : (
        <Wizard testId="administrative-import">
          <WizardRail steps={steps} at={at} onGo={setAt} />

          {at === 0 || item === null ? (
            <>
              <WizardBody>
                <ItemPicker
                  batchId={batchId}
                  items={administrative}
                  value={itemId}
                  onPick={choose}
                />
              </WizardBody>
              <WizardFoot>
                <Button
                  disabled={item === null}
                  onClick={() => setAt(1)}
                  data-testid="record-step-next"
                >
                  {m.record_stepNext()}
                </Button>
              </WizardFoot>
            </>
          ) : at === 1 || preview === null ? (
            <>
              <WizardBody>
                <WizardSection title={m.record_import_templateTitle()}>
                  <span {...stylex.props(styles.quiet)}>{m.record_import_templateHint()}</span>
                  <span {...stylex.props(styles.templateRow)}>
                    <TemplateDownload item={item} />
                  </span>
                </WizardSection>

                <WizardSection title={m.record_import_file()}>
                  <Field label={m.record_import_file()} hideLabel hint={m.record_import_fileHint()}>
                    {() => (
                      <div {...stylex.props(styles.seat)} data-upload-seat>
                        {uploaded === null ? (
                          <Dropzone
                            accept={{ [XLSX]: ['.xlsx'] }}
                            maxFiles={1}
                            multiple={false}
                            disabled={upload.isPending}
                            xstyle={[styles.seatBox, styles.seatEmpty]}
                            onFiles={(files) => {
                              const file = files[0]
                              if (file !== undefined) upload.mutate(file)
                            }}
                          >
                            <span data-slot="dropzone-said" {...stylex.props(styles.uploading)}>
                              {upload.isPending && <Spinner />}
                              {(upload.isPending
                                ? m.record_import_uploading
                                : m.record_import_chooseFile)()}
                            </span>
                          </Dropzone>
                        ) : (
                          <FileTile
                            xstyle={styles.seatBox}
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
                                {m.record_import_chooseAnother()}
                              </Button>
                            }
                          />
                        )}
                      </div>
                    )}
                  </Field>
                </WizardSection>

                <WizardSection title={m.record_import_defaultBasis()}>
                  <Field
                    label={m.record_import_defaultBasis()}
                    hideLabel
                    hint={m.record_import_defaultBasisHint()}
                  >
                    {(id) => (
                      <Input
                        id={id}
                        value={basis}
                        onChange={(event) => setBasis(event.target.value)}
                      />
                    )}
                  </Field>
                </WizardSection>

                {refusal !== null && (
                  <div {...stylex.props(styles.refused)} data-testid="import-refused">
                    <p {...stylex.props(styles.refusedTitle)}>{m.record_import_fileUnreadable()}</p>
                    {refusal.sentence !== null ? (
                      <p {...stylex.props(styles.quiet)}>{refusal.sentence}</p>
                    ) : (
                      <div {...stylex.props(styles.fileIssues)}>
                        {refusal.issues.map((issue, index) => (
                          <span key={index} data-reason={issue.reason}>
                            {reasonText(issue, businessNo)}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* the way out, beside what is wrong: every refusal at
                        this level is answered by starting from the template
                        again */}
                    <div {...stylex.props(styles.templateRow)}>
                      <TemplateDownload item={item} />
                      <span {...stylex.props(styles.templateNote)}>
                        {m.record_import_refusedHint()}
                      </span>
                    </div>
                  </div>
                )}
              </WizardBody>
              <WizardFoot
                status={
                  check.isPending
                    ? m.record_import_checking()
                    : (uploaded === null
                        ? m.record_import_needsFile
                        : m.record_import_readyToCheck)()
                }
                blocked={uploaded === null}
              >
                <Button variant="outline" onClick={() => setAt(0)} data-testid="record-step-back">
                  {m.record_stepBack()}
                </Button>
                <Button
                  disabled={uploaded === null || upload.isPending || check.isPending}
                  onClick={() => check.mutate({ attachmentId: uploaded!.attachmentId, basis })}
                  data-testid="record-step-next"
                >
                  {m.record_stepNext()}
                </Button>
              </WizardFoot>
            </>
          ) : (
            <>
              <WizardBody>
                {preview.summary.errors === 0 && (
                  <WizardNotice>{m.record_effectNotice()}</WizardNotice>
                )}
                <WizardSection title={m.record_import_result()}>
                  <WizardRecap>
                    <WizardRecapRow term={m.record_actItem()}>{item.title}</WizardRecapRow>
                    <WizardRecapRow term={m.record_import_file()}>
                      {uploaded?.filename ?? ''}
                    </WizardRecapRow>
                    {basis.trim() !== '' && (
                      <WizardRecapRow term={m.record_import_defaultBasis()}>
                        {basis.trim()}
                      </WizardRecapRow>
                    )}
                  </WizardRecap>

                  <div
                    {...stylex.props(styles.tally)}
                    data-testid="import-preview"
                    data-rows={preview.summary.rows}
                    data-errors={preview.summary.errors}
                    data-warnings={preview.summary.warnings}
                  >
                    {/* the total is context, not a verdict, so it stays plain
                        at every width */}
                    <span>{m.record_import_summaryRows({ count: preview.summary.rows })}</span>
                    <span {...stylex.props(styles.tallyPart, styles.tallyGood)}>
                      {m.record_import_summaryValid({ count: preview.summary.valid })}
                    </span>
                    {preview.summary.warnings > 0 && (
                      <span {...stylex.props(styles.tallyPart, styles.tallyCheck)}>
                        {m.record_import_summaryWarnings({ count: preview.summary.warnings })}
                      </span>
                    )}
                    {preview.summary.errors > 0 && (
                      <span {...stylex.props(styles.tallyPart, styles.tallyBad)}>
                        {m.record_import_summaryErrors({ count: preview.summary.errors })}
                      </span>
                    )}
                  </div>

                  {preview.summary.errors > 0 ? (
                    <WizardNotice bad>{m.record_import_fixAndRetry()}</WizardNotice>
                  ) : flagged.length === 0 && preview.summary.rows > 0 ? (
                    <p {...stylex.props(styles.quiet)}>{m.record_import_allReady()}</p>
                  ) : null}
                </WizardSection>

                {shown.length > 0 && (
                  <WizardSection title={m.record_import_rows()}>
                    <div {...stylex.props(styles.table)} role="table">
                      <div role="row" {...stylex.props(styles.row, styles.head)}>
                        <span role="columnheader">{m.record_import_columnRow()}</span>
                        <span role="columnheader">{businessNo}</span>
                        <span role="columnheader">{m.record_import_columnName()}</span>
                        <span role="columnheader">{m.record_import_columnIssues()}</span>
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
                              : row.issues.map((issue, index) => {
                                  const where = fieldText(issue.field, names, businessNo)
                                  return (
                                    <span key={index} {...stylex.props(styles.issue)}>
                                      <Badge
                                        variant={
                                          issue.severity === 'error' ? 'destructive' : 'outline'
                                        }
                                      >
                                        {(issue.severity === 'error'
                                          ? m.record_import_severityError
                                          : m.record_import_severityWarning)()}
                                      </Badge>
                                      <span>
                                        {where === null
                                          ? reasonText(issue, businessNo)
                                          : m.record_import_issueAt({
                                              field: where,
                                              reason: reasonText(issue, businessNo),
                                            })}
                                      </span>
                                    </span>
                                  )
                                })}
                          </span>
                        </div>
                      ))}
                    </div>
                    {preview.rows.length > flagged.length && (
                      <div {...stylex.props(styles.rowsHead)}>
                        <Button size="sm" variant="ghost" onClick={() => setShowAll((all) => !all)}>
                          {showAll
                            ? m.record_import_showProblems()
                            : m.record_import_showAll({ count: preview.summary.rows })}
                        </Button>
                      </div>
                    )}
                  </WizardSection>
                )}
              </WizardBody>
              <WizardFoot>
                {preview.canCommit && preview.summary.warnings > 0 && (
                  <label {...stylex.props(styles.confirm)}>
                    <Checkbox
                      checked={confirmed}
                      onCheckedChange={setConfirmed}
                      data-testid="import-confirm-warnings"
                    />
                    {m.record_import_confirmWarnings()}
                  </label>
                )}
                <Button variant="outline" onClick={() => setAt(1)} data-testid="record-step-back">
                  {m.record_stepBack()}
                </Button>
                {/* The one press that writes anything stays on the screen
                    even when it cannot be pressed. A button that disappears
                    leaves the reader looking for it; a grey one that says
                    why on hover leaves them looking at what to fix. */}
                <CommitButton
                  label={m.record_import_commit({ count: preview.summary.valid })}
                  why={
                    ready
                      ? null
                      : (!preview.canCommit
                          ? m.record_import_blockedErrors
                          : preview.summary.warnings > 0 && !confirmed
                            ? m.record_import_blockedWarnings
                            : m.record_import_blockedBusy)()
                  }
                  onPress={() => commit.mutate()}
                />
              </WizardFoot>
            </>
          )}
        </Wizard>
      )}
    </AsyncSection>
  )
}

/**
 * The press that writes the file in, and what is standing in its way.
 *
 * Shown always, greyed when it cannot run, and carrying its own reason: the
 * three things that stop it - rows with errors, warnings nobody has ticked
 * off, an import already running - look identical on a grey key.
 */
function CommitButton({
  label,
  why,
  onPress,
}: {
  label: string
  /** null when it can be pressed */
  why: string | null
  onPress: () => void
}) {
  const button = (
    <Button disabled={why !== null} onClick={onPress} data-testid="import-commit">
      {label}
    </Button>
  )
  if (why === null) return button
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{button}</span>
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** the one press that answers "where do I get the right file" */
function TemplateDownload({ item }: { item: ItemDto }) {
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
        {m.record_import_template({ item: item.title })}
      </a>
    </Button>
  )
}
