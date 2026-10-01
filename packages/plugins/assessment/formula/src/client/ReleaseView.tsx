import { formatPlatformFailure as formatError, useLocale } from '@qualy/web-i18n'

import * as stylex from '@stylexjs/stylex'
import { Suspense, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoadFailure, useApi, useApiQuery, useLoadFailure, useRunApi } from '@qualy/web-runtime'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { EmptyRow } from '@qualy/ui/empty-row'
import { Spinner } from '@qualy/ui/spinner'
import { toast } from '@qualy/ui/toast'
import { downloadText, fileNameOf } from '@qualy/ui/download'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { type NormalizedAtomicSchema, type NormalizedInputSchema } from '@qualy/value-schema'
import { draftsFromStored, materializeInput, type FieldDraft } from '@qualy/web-value-form/model'
import { useTryRecords } from './try-records.ts'
import { CopyIcon, DownloadIcon, FilePenLineIcon, LockIcon, MoreHorizontalIcon } from 'lucide-react'
import { formulaApi } from './api.ts'

import { ReleaseInfoPopover } from './ReleaseInfoPopover.tsx'
import { LazyFormulaSourceViewer } from './lazy-editors.ts'
import { inputFactsOf, inputIssueWords, outcomeWords, type OutcomeLike } from './report-words.ts'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@qualy/ui/sheet'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { InputValueForm } from '@qualy/web-value-form/InputValueForm'
import { usePickerWords } from '@qualy/web-i18n/picker-words'
import { ContractTable } from './ContractTable.tsx'
import { ExampleRow } from './ExampleRow.tsx'
import { exampleStyles } from './example-grid.ts'
import { TryRunPanel, type TryOutcome } from './TryRunPanel.tsx'
import { TryRecordsDrawer } from './TryRecordsDrawer.tsx'
import { WorkbenchBar, WorkbenchLayout, type WorkbenchTab } from './WorkbenchLayout.tsx'
import { workbenchStyles as w } from './workbench-styles.ts'
import * as m from '#messages'

// One publication of a formula, as it was frozen.
//
// Everything here is read off the version row: its source, its examples and
// the report they produced, its contract and the toolchain that proved it.
// Nothing is compiled again - putting yesterday's source through today's
// compiler would show a different world and call it this publication - and
// a try-run runs the very artifact that was frozen. What the publication is
// called, and who it is shared with, is beside its line in the history.

const styles = stylex.create({
  loading: {
    display: 'flex',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  wide: { width: '100%' },
  digest: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  digestHead: {
    fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 12,
  },
  copy: {
    display: 'inline-flex',
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 6,
    padding: 0,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  statusRule: { width: 1, height: 10, flexShrink: 0, backgroundColor: tokens.border },
  statusName: {
    minWidth: 0,
    maxWidth: '24rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sourceFill: { display: 'flex', minHeight: '18rem', flexGrow: 1, flexDirection: 'column' },
  // the same sheet the editor opens on a case, minus everything that could
  // change one: a published example is a record of what was proved
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
  caseLine: { display: 'flex', alignItems: 'baseline', gap: 10, margin: 0, fontSize: 13 },
  caseValue: { minWidth: 0, margin: 0, overflowWrap: 'anywhere', fontWeight: 500 },
  caseVerdict: { display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 13 },
  caseGood: { color: tokens.success },
  caseBad: { color: tokens.danger },
  caseFoot: { display: 'flex', gap: 8, paddingInline: 24, paddingBottom: 20 },
})

interface ReportRow extends OutcomeLike {
  readonly name: string
  readonly expected: string
}

export function ReleaseView({
  functionId,
  functionName,
  versionNo,
  latestVersionNo,
  archived,
  narrow,
  titleRef,
  lease,
  versionsButton,
  drawers,
  motion,
  onBack,
  onRestore,
  onEditInfo,
  restoring,
}: {
  readonly functionId: string
  readonly functionName: string
  readonly versionNo: number
  readonly latestVersionNo: number | null
  readonly archived: boolean
  readonly narrow: boolean
  readonly titleRef: (node: HTMLElement | null) => void
  /** the page's editor lease, which the read-only source hangs on */
  readonly lease: string
  /** the bar's way into the versions, which the page owns */
  readonly versionsButton: ReactNode
  /** the drawers the page keeps open across views */
  readonly drawers: ReactNode
  /** set when this state was opened from inside the page rather than linked to */
  readonly motion?: 'forward'
  readonly onBack: () => void
  readonly onRestore: (release: { versionNo: number; name: string }) => void
  /** opens this publication's name and notes for rewriting */
  readonly onEditInfo: (release: {
    versionNo: number
    releaseName: string | null
    releaseNotes: string | null
    metadataRevision: number
  }) => void
  readonly restoring: boolean
}) {
  const api = useApi(formulaApi)
  const run = useRunApi()
  const query = useApiQuery(formulaApi)
  const locale = useLocale()
  const words = usePickerWords()
  const [panelTab, setPanelTab] = useState('report')
  const [phoneTab, setPhoneTab] = useState('source')
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({})
  const [issues, setIssues] = useState<ReadonlyMap<string, string> | undefined>(undefined)
  // how the last press came out, stamped so two presses in a row each get
  // their own beat on the button
  const [verdict, setVerdict] = useState<{
    at: number
    kind: 'refused' | 'ran' | 'failed'
  } | null>(null)
  const [result, setResult] = useState<{ outcome: TryOutcome; forCase: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [ranAt, setRanAt] = useState<number | null>(null)

  // what this browser remembers trying against this publication
  const tryRecords = useTryRecords(functionId, `release/${String(versionNo)}`)
  const detail = useQuery(
    query.assessmentFormula.getFormulaVersion.queryOptions({
      params: { functionId, versionNo: String(versionNo) },
    }),
  )
  const version = detail.data?.version
  const displayName =
    version === undefined
      ? ''
      : (version.releaseName ?? m.history_releaseOrdinal({ number: version.versionNo }))
  const inputSchema = (version?.inputSchema ?? null) as NormalizedInputSchema | null
  // what this publication IS, for the card beside its name: the label, who
  // published it and when, and who last rewrote the label
  const info =
    version === undefined
      ? null
      : {
          versionNo: version.versionNo,
          releaseName: version.releaseName,
          releaseNotes: version.releaseNotes,
          publishedAt: version.publishedAt,
          publishedByName: version.publishedByName,
          metadataRevision: version.metadataRevision,
          metadataUpdatedAt: version.metadataUpdatedAt,
          metadataUpdatedByName: version.metadataUpdatedByName,
        }

  const download = () => {
    if (version === undefined) return
    const filename = fileNameOf([functionName, displayName], '.ts')
    downloadText({ filename, text: version.sourceTs, type: 'text/typescript;charset=utf-8' })
    toast.success(m.editor_downloaded({ file: filename }))
  }
  const restore = () => onRestore({ versionNo, name: displayName })

  // a try runs the artifact the publication froze, never a new compile
  const runTry = async () => {
    if (inputSchema === null) return
    const frozenDrafts = { ...drafts }
    const materialized = materializeInput(inputSchema, frozenDrafts)
    if (materialized.value === null) {
      // the fields mark themselves, but on a long contract they do it
      // somewhere the reader is not looking
      const words = inputIssueWords(inputSchema, materialized.issues)
      setIssues(words)
      setVerdict({ at: Date.now(), kind: 'refused' })
      toast.error(m.editor_runNeedsFields({ count: words.size }))
      return
    }
    setIssues(undefined)
    setRunning(true)
    try {
      const answered = (await run(
        api.assessmentFormula.evaluateFormulaVersion({
          params: { functionId, versionNo: String(versionNo) },
          payload: { cases: [{ clientId: 'try', input: materialized.value }] },
        }),
      )) as { cases: readonly TryOutcome[] }
      const outcome = answered.cases[0] ?? {}
      tryRecords.add({ input: materialized.value, outcome })
      setRanAt(Date.now())
      setResult({ outcome, forCase: JSON.stringify(frozenDrafts) })
      setVerdict({ at: Date.now(), kind: outcome.actual === undefined ? 'failed' : 'ran' })
    } catch (error) {
      toast.error(formatError(error))
      setVerdict({ at: Date.now(), kind: 'failed' })
    } finally {
      setRunning(false)
    }
  }

  const report = (version?.testReport ?? []) as readonly ReportRow[]
  const tests = version?.tests ?? []
  const passed = report.filter((row) => row.passed === true).length

  const loadFailure = useLoadFailure()
  const unreadable = (error: unknown) =>
    loadFailure.of(error, { missing: ['ASSESSMENT_FORMULA_VERSION_NOT_FOUND'] })
  const retryable = detail.isError && unreadable(detail.error).retryable
  // A publication that is not there - an address somebody kept, one deleted
  // since - is said so, with the way back to the draft rather than another
  // try; one that could not be read gets another try as well.
  const pending = detail.isError ? (
    <div {...stylex.props(styles.loading)}>
      <LoadFailure
        size="section"
        failure={unreadable(detail.error)}
        onRetry={() => void detail.refetch()}
        retrying={detail.isFetching}
        extra={
          <Button size="sm" variant={retryable ? 'outline' : 'default'} onClick={onBack}>
            {m.history_backToDraft()}
          </Button>
        }
      />
    </div>
  ) : (
    <div role="status" {...stylex.props(styles.loading)}>
      <Spinner aria-label={m.editor_loading()} />
    </div>
  )

  const source =
    version === undefined ? (
      pending
    ) : (
      <div {...stylex.props(styles.sourceFill)}>
        <Suspense fallback={pending}>
          <LazyFormulaSourceViewer
            functionId={functionId}
            lease={lease}
            name={`release-${String(versionNo)}`}
            source={version.sourceTs}
            label={m.release_source()}
            readOnlyLabel={m.history_readOnly()}
            data-testid="formula-release-source"
          />
        </Suspense>
      </div>
    )

  const tryRun = (phone: boolean) => (
    <TryRunPanel
      title={m.editor_tryTitle()}
      narrow={phone}
      status={{ state: 'frozen', tone: 'quiet', words: '' }}
      schema={inputSchema}
      pending={{
        state: detail.isError ? 'refused' : 'loading',
        words: detail.isError ? unreadable(detail.error).title : m.editor_loading(),
        working: !detail.isError,
        off: detail.isError,
      }}
      drafts={drafts}
      onDraft={(name, draft) => setDrafts({ ...drafts, [name]: draft })}
      issues={issues}
      verdict={verdict}
      disabled={false}
      running={running}
      result={
        result === null
          ? null
          : {
              outcome: result.outcome,
              fresh: result.forCase === JSON.stringify(drafts),
              ...(ranAt === null ? {} : { at: ranAt }),
            }
      }
      onRun={() => void runTry()}
      recordCount={tryRecords.records.length}
      onOpenRecords={() => setRecordsOpen(true)}
    />
  )

  // The same lines the editor shows, in the same six columns: a published
  // version's examples are read the way its author read them. What differs
  // is that nothing here can be run, copied or taken away - it is a record
  // - so a line offers one act, filling the try column from it, and its
  // sheet shows the values without letting anybody move them.
  const [openCase, setOpenCase] = useState<number | null>(null)
  const caseAt = openCase === null ? undefined : report[openCase]
  const reportTable =
    version === undefined ? null : report.length === 0 ? (
      <div {...stylex.props(w.emptyFill)}>
        <EmptyRow>{m.release_noReport()}</EmptyRow>
      </div>
    ) : (
      <>
        <div {...stylex.props(exampleStyles.columns, exampleStyles.head)}>
          <span>{m.editor_testName()}</span>
          <span>{m.examples_inputColumn()}</span>
          <span {...stylex.props(exampleStyles.end)}>{m.examples_expectedColumn()}</span>
          <span {...stylex.props(exampleStyles.end)}>{m.report_actualColumn()}</span>
          <span>{m.report_outcome()}</span>
          <span />
        </div>
        <div {...stylex.props(w.panelScroll)} data-testid="formula-release-report">
          {report.map((row, index) => (
            <ExampleRow
              key={index}
              readOnly
              index={index}
              name={row.name}
              narrow={narrow}
              facts={inputFactsOf(locale, inputSchema, tests[index]?.input)}
              expected={row.expected}
              outcome={{
                ...(row.actual === undefined ? {} : { actual: row.actual }),
                stale: false,
              }}
              verdict={row.passed === true ? 'passed' : 'failed'}
              legal
              open={openCase === index}
              onOpen={() => setOpenCase(index)}
              locked
              running={false}
              onLoadIntoTry={() => {
                if (inputSchema === null) return
                setDrafts(draftsFromStored(inputSchema, tests[index]?.input))
                setIssues(undefined)
                setResult(null)
                toast.success(m.editor_loadedIntoTry())
                setOpenCase(null)
              }}
            />
          ))}
        </div>
      </>
    )

  const contract =
    version === undefined ? null : (
      <ContractTable
        inputSchema={version.inputSchema as NormalizedInputSchema}
        outputSchema={version.outputSchema as NormalizedAtomicSchema}
      />
    )

  // A digest is an identity to compare, not a number to read: its head is
  // enough to tell two apart on screen, and the whole of it is one press away.
  const digest = (value: string) => (
    <span {...stylex.props(styles.digest)}>
      <code {...stylex.props(styles.digestHead)}>{value.slice(0, 12)}</code>
      <button
        type="button"
        data-testid="formula-copy-digest"
        aria-label={m.release_copyValue()}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => toast.success(m.release_copied()))
            .catch(() => toast.error(m.release_copyFailed()))
        }}
        {...stylex.props(styles.copy)}
      >
        <CopyIcon size={13} aria-hidden />
      </button>
    </span>
  )

  const environment =
    version === undefined ? null : (
      <dl data-testid="formula-release-environment" {...stylex.props(w.facts)}>
        {(
          [
            [m.release_envTypescript, version.typescriptVersion, false],
            [m.release_envEsbuild, version.esbuildVersion, false],
            [m.release_envQuickjs, version.quickjsEngineVersion, false],
            [m.release_envFormulaAbi, String(version.formulaAbiVersion), false],
            [m.release_envSandboxAbi, String(version.sandboxAbiVersion), false],
            [m.release_envValueSchema, String(version.valueSchemaProfileVersion), false],
            [m.release_envRegex, String(version.regexProfileVersion), false],
            [
              m.release_envSourcePolicy,
              `${String(version.sourcePolicyVersion)} (${version.sourcePolicyParserVersion})`,
              false,
            ],
            [m.release_envAuthoringBuild, version.authoringBuildId, true],
            [m.release_envRuntimeBuild, version.sandboxRuntimeBuildId, true],
            [m.release_envSourceSha, version.sourceSha256, true],
            [m.release_envRuntimeSha, version.runtimeSha256, true],
            [m.release_envContractSha, version.contractSha256, true],
            [m.release_envFormulaRuntimeSha, version.formulaRuntimeSha256, true],
          ] as const
        ).map(([label, value, long]) => (
          <div key={label()} {...stylex.props(w.fact)}>
            <dt {...stylex.props(w.factLabel)}>{label()}</dt>
            <dd {...stylex.props(w.factValue)}>{long ? digest(value) : value}</dd>
          </div>
        ))}
      </dl>
    )

  const scroll = (node: ReactNode) => <div {...stylex.props(w.panelScroll)}>{node}</div>

  const restoreButton = (
    <Button
      size={narrow ? 'lg' : 'sm'}
      data-testid="formula-release-restore"
      disabled={archived || restoring || version === undefined}
      onClick={restore}
      className={narrow ? stylex.props(styles.wide).className : undefined}
    >
      <FilePenLineIcon aria-hidden />
      {m.release_restore()}
    </Button>
  )

  const panelTabs: WorkbenchTab[] = [
    {
      value: 'report',
      label: m.release_reportTab(),
      tone:
        report.length > 0 && passed === report.length
          ? 'good'
          : report.length > 0
            ? 'bad'
            : 'quiet',
      count: report.length,
      content: scroll(reportTable),
    },
    { value: 'contract', label: m.release_contractTab(), content: scroll(contract) },
    { value: 'environment', label: m.release_environmentTab(), content: scroll(environment) },
  ]

  return (
    <WorkbenchLayout
      narrow={narrow}
      testId="formula-release-view"
      status="release"
      {...(motion === undefined ? {} : { motion })}
      bar={
        <WorkbenchBar
          narrow={narrow}
          frozen
          backLabel={m.history_backToDraft()}
          onBack={onBack}
          titleRef={titleRef}
          title={<span {...stylex.props(w.title)}>{displayName}</span>}
          badge={
            <>
              <span {...stylex.props(w.standing, w.standingOutline)}>
                <LockIcon size={11} aria-hidden />
                {m.history_readOnly()}
              </span>
              {versionNo === latestVersionNo ? (
                <span {...stylex.props(w.standing, w.standingQuiet)}>{m.version_latest()}</span>
              ) : null}
            </>
          }
          status={
            <>
              <span {...stylex.props(styles.statusName)}>{functionName}</span>
              <span aria-hidden {...stylex.props(styles.statusRule)} />
              <span>{m.history_releaseOrdinal({ number: versionNo })}</span>
            </>
          }
          actions={
            <>
              {versionsButton}
              {info === null ? null : (
                <ReleaseInfoPopover
                  release={info}
                  testId="formula-release-info-open"
                  onEdit={() => onEditInfo(info)}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={version === undefined}
                onClick={download}
              >
                <DownloadIcon aria-hidden />
                {m.history_downloadCode()}
              </Button>
              {restoreButton}
            </>
          }
          phoneActions={versionsButton}
          phoneMenu={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={m.editor_moreActions()}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onBack}>{m.history_backToDraft()}</DropdownMenuItem>
                <DropdownMenuItem disabled={version === undefined} onSelect={download}>
                  {m.history_downloadCode()}
                </DropdownMenuItem>
                {info === null ? null : (
                  <DropdownMenuItem onSelect={() => onEditInfo(info)}>
                    {m.release_infoEdit()}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      }
      source={source}
      tryRun={tryRun(false)}
      tryLabel={m.editor_tryTitle()}
      panelTabs={panelTabs}
      panelTab={panelTab}
      onPanelTab={setPanelTab}
      panelLabel={m.release_details()}
      phoneTabs={[
        { value: 'source', label: m.editor_phoneSourceTab(), content: source },
        { value: 'try', label: m.editor_tryTitle(), content: tryRun(true) },
        ...panelTabs,
      ]}
      phoneTab={phoneTab}
      onPhoneTab={setPhoneTab}
      gate={{
        label: m.history_title(),
        tone: report.length > 0 && passed === report.length ? 'good' : 'quiet',
        words: displayName,
      }}
      foot={restoreButton}
    >
      {drawers}
      {/* One frozen example, read in full. Every field is disabled: this is
          what was proved on the day, and a box somebody can type in invites
          them to believe otherwise. The one act left is taking its input
          over into the try column, where changing things is the point. */}
      <Sheet open={caseAt !== undefined} onOpenChange={(open) => !open && setOpenCase(null)}>
        <SheetContent side={narrow ? 'bottom' : 'right'} xstyle={styles.caseSheet}>
          <SheetHeader>
            <SheetTitle>{m.editor_releaseCaseTitle()}</SheetTitle>
            <SheetDescription>{m.editor_releaseCaseHint()}</SheetDescription>
          </SheetHeader>
          {caseAt === undefined || openCase === null ? null : (
            <div data-testid="formula-release-case" {...stylex.props(styles.caseBody)}>
              <section {...stylex.props(styles.casePart)}>
                <h3 {...stylex.props(styles.casePartTitle)}>{m.editor_testName()}</h3>
                <div {...stylex.props(styles.casePartBody)}>
                  <p {...stylex.props(styles.caseValue)}>
                    {caseAt.name === '' ? m.examples_unnamed() : caseAt.name}
                  </p>
                </div>
              </section>
              <section {...stylex.props(styles.casePart)}>
                <h3 {...stylex.props(styles.casePartTitle)}>{m.editor_testInput()}</h3>
                <div {...stylex.props(styles.casePartBody)}>
                  {inputSchema === null ? (
                    <p {...stylex.props(styles.caseValue)}>
                      {JSON.stringify(tests[openCase]?.input ?? {})}
                    </p>
                  ) : (
                    <InputValueForm
                      words={words}
                      schema={inputSchema}
                      drafts={draftsFromStored(inputSchema, tests[openCase]?.input)}
                      onDraft={() => {}}
                      locale={locale}
                      disabled
                      scope={`release-case-${openCase}`}
                    />
                  )}
                </div>
              </section>
              <section {...stylex.props(styles.casePart)}>
                <h3 {...stylex.props(styles.casePartTitle)}>{m.report_outcome()}</h3>
                <div {...stylex.props(styles.casePartBody)}>
                  <p {...stylex.props(styles.caseLine)}>
                    <span>{m.examples_expectedColumn()}</span>
                    <span {...stylex.props(styles.caseValue)}>{caseAt.expected}</span>
                  </p>
                  <p {...stylex.props(styles.caseLine)}>
                    <span>{m.report_actualColumn()}</span>
                    <span {...stylex.props(styles.caseValue)}>
                      {caseAt.actual ?? m.examples_actualNone()}
                    </span>
                  </p>
                  <p
                    data-testid="formula-release-case-verdict"
                    data-passed={caseAt.passed === true}
                    {...stylex.props(
                      styles.caseVerdict,
                      caseAt.passed === true ? styles.caseGood : styles.caseBad,
                    )}
                  >
                    {(caseAt.passed === true ? m.editor_resultPassed : m.report_failed)()}
                  </p>
                  {outcomeWords(caseAt) === null ? null : (
                    <p {...stylex.props(styles.caseLine)}>{outcomeWords(caseAt)}</p>
                  )}
                </div>
              </section>
            </div>
          )}
          {caseAt === undefined || openCase === null ? null : (
            <SheetFooter xstyle={styles.caseFoot}>
              <Button
                variant="outline"
                size="sm"
                disabled={inputSchema === null}
                data-testid="formula-release-case-load"
                onClick={() => {
                  if (inputSchema === null) return
                  setDrafts(draftsFromStored(inputSchema, tests[openCase]?.input))
                  setIssues(undefined)
                  setResult(null)
                  toast.success(m.editor_loadedIntoTry())
                  setOpenCase(null)
                }}
              >
                {m.editor_loadIntoTry()}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
      <TryRecordsDrawer
        open={recordsOpen}
        onOpenChange={setRecordsOpen}
        narrow={narrow}
        records={tryRecords.records}
        schema={inputSchema}
        onPick={(record) => {
          if (inputSchema === null) return
          const picked = draftsFromStored(inputSchema, record.input)
          setDrafts(picked)
          setIssues(undefined)
          setRanAt(record.at)
          setResult({ outcome: record.outcome, forCase: JSON.stringify(picked) })
          setRecordsOpen(false)
        }}
        onClear={tryRecords.clear}
      />
    </WorkbenchLayout>
  )
}
