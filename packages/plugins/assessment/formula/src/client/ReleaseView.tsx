import * as stylex from '@stylexjs/stylex'
import { Suspense, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
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
import type { NormalizedAtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'
import { draftsFromStored, materializeInput, type FieldDraft } from '@qualy/web-value-form/model'
import { useTryRecords } from './try-records.ts'
import { CopyIcon, DownloadIcon, FilePenLineIcon, LockIcon, MoreHorizontalIcon } from 'lucide-react'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { ReleaseInfoPopover } from './ReleaseInfoPopover.tsx'
import { LazyFormulaSourceViewer } from './lazy-editors.ts'
import { inputIssueWords, inputSummaryOf, outcomeWords, type OutcomeLike } from './report-words.ts'
import { ContractTable } from './ContractTable.tsx'
import { TryRunPanel, type TryOutcome } from './TryRunPanel.tsx'
import { TryRecordsDrawer } from './TryRecordsDrawer.tsx'
import { WorkbenchBar, WorkbenchLayout, type WorkbenchTab } from './WorkbenchLayout.tsx'
import { workbenchStyles as w } from './workbench-styles.ts'

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
  const { format, formatError } = useI18n()
  const [panelTab, setPanelTab] = useState('report')
  const [phoneTab, setPhoneTab] = useState('source')
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({})
  const [issues, setIssues] = useState<ReadonlyMap<string, string> | undefined>(undefined)
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
      : (version.releaseName ?? format(m.releaseOrdinal, { number: version.versionNo }))
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
    toast.success(format(m.downloaded, { file: filename }))
  }
  const restore = () => onRestore({ versionNo, name: displayName })

  // a try runs the artifact the publication froze, never a new compile
  const runTry = async () => {
    if (inputSchema === null) return
    const frozenDrafts = { ...drafts }
    const materialized = materializeInput(inputSchema, frozenDrafts)
    if (materialized.value === null) {
      setIssues(inputIssueWords(format, inputSchema, materialized.issues))
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
    } catch (error) {
      toast.error(formatError(error))
    } finally {
      setRunning(false)
    }
  }

  const report = (version?.testReport ?? []) as readonly ReportRow[]
  const tests = version?.tests ?? []
  const passed = report.filter((row) => row.passed === true).length

  const pending = (
    <div role="status" {...stylex.props(styles.loading)}>
      {detail.isError ? (
        <EmptyRow role="alert">{formatError(detail.error)}</EmptyRow>
      ) : (
        <Spinner aria-label={format(m.editorLoading)} />
      )}
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
            label={format(m.releaseSource)}
            readOnlyLabel={format(m.readOnly)}
            data-testid="formula-release-source"
          />
        </Suspense>
      </div>
    )

  const tryRun = (phone: boolean) => (
    <TryRunPanel
      title={format(m.tryTitle)}
      narrow={phone}
      status={{ state: 'frozen', tone: 'quiet', words: '' }}
      schema={inputSchema}
      pending={{
        state: detail.isError ? 'refused' : 'loading',
        words: detail.isError ? formatError(detail.error) : format(m.editorLoading),
        working: !detail.isError,
        off: detail.isError,
      }}
      drafts={drafts}
      onDraft={(name, draft) => setDrafts({ ...drafts, [name]: draft })}
      issues={issues}
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

  const reportTable =
    version === undefined ? null : report.length === 0 ? (
      <div {...stylex.props(w.emptyFill)}>
        <EmptyRow>{format(m.releaseNoReport)}</EmptyRow>
      </div>
    ) : (
      <table data-testid="formula-release-report" {...stylex.props(w.reportTable)}>
        <thead>
          <tr>
            <th {...stylex.props(w.reportHead)}>{format(m.testName)}</th>
            <th {...stylex.props(w.reportHead)}>{format(m.examplesInputColumn)}</th>
            <th {...stylex.props(w.reportHead)}>{format(m.examplesExpectedColumn)}</th>
            <th {...stylex.props(w.reportHead)}>{format(m.reportActualColumn)}</th>
            <th {...stylex.props(w.reportHead)}>{format(m.reportOutcome)}</th>
          </tr>
        </thead>
        <tbody>
          {report.map((row, index) => {
            const notes = outcomeWords(format, row)
            return (
              <tr key={index} data-passed={row.passed === true}>
                <td {...stylex.props(w.reportCell)}>{row.name}</td>
                <td {...stylex.props(w.reportCell, w.wrapMono, w.quiet)}>
                  {inputSummaryOf(tests[index]?.input)}
                </td>
                <td {...stylex.props(w.reportCell, w.mono)}>{row.expected}</td>
                <td {...stylex.props(w.reportCell, w.mono)}>
                  {row.actual ?? format(m.actualNone)}
                </td>
                <td
                  title={notes ?? undefined}
                  {...stylex.props(w.reportCell, row.passed === true ? w.good : w.bad)}
                >
                  {format(row.passed === true ? m.resultPassed : m.reportFailed)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
        aria-label={format(m.copyValue)}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => toast.success(format(m.copied)))
            .catch(() => toast.error(format(m.copyFailed)))
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
            [m.envTypescript, version.typescriptVersion, false],
            [m.envEsbuild, version.esbuildVersion, false],
            [m.envQuickjs, version.quickjsEngineVersion, false],
            [m.envFormulaAbi, String(version.formulaAbiVersion), false],
            [m.envSandboxAbi, String(version.sandboxAbiVersion), false],
            [m.envValueSchema, String(version.valueSchemaProfileVersion), false],
            [m.envRegex, String(version.regexProfileVersion), false],
            [
              m.envSourcePolicy,
              `${String(version.sourcePolicyVersion)} (${version.sourcePolicyParserVersion})`,
              false,
            ],
            [m.envAuthoringBuild, version.authoringBuildId, true],
            [m.envRuntimeBuild, version.sandboxRuntimeBuildId, true],
            [m.envSourceSha, version.sourceSha256, true],
            [m.envRuntimeSha, version.runtimeSha256, true],
            [m.envContractSha, version.contractSha256, true],
            [m.envFormulaRuntimeSha, version.formulaRuntimeSha256, true],
          ] as const
        ).map(([label, value, long]) => (
          <div key={label.id} {...stylex.props(w.fact)}>
            <dt {...stylex.props(w.factLabel)}>{format(label)}</dt>
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
      {format(m.releaseRestore)}
    </Button>
  )

  const panelTabs: WorkbenchTab[] = [
    {
      value: 'report',
      label: format(m.releaseReportTab),
      tone:
        report.length > 0 && passed === report.length
          ? 'good'
          : report.length > 0
            ? 'bad'
            : 'quiet',
      count: report.length,
      content: scroll(reportTable),
    },
    { value: 'contract', label: format(m.releaseContractTab), content: scroll(contract) },
    { value: 'environment', label: format(m.releaseEnvironmentTab), content: scroll(environment) },
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
          backLabel={format(m.backToDraft)}
          onBack={onBack}
          titleRef={titleRef}
          title={<span {...stylex.props(w.title)}>{displayName}</span>}
          badge={
            <>
              <span {...stylex.props(w.standing, w.standingOutline)}>
                <LockIcon size={11} aria-hidden />
                {format(m.readOnly)}
              </span>
              {versionNo === latestVersionNo ? (
                <span {...stylex.props(w.standing, w.standingQuiet)}>
                  {format(m.versionLatest)}
                </span>
              ) : null}
            </>
          }
          status={
            <>
              <span {...stylex.props(styles.statusName)}>{functionName}</span>
              <span aria-hidden {...stylex.props(styles.statusRule)} />
              <span>{format(m.releaseOrdinal, { number: versionNo })}</span>
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
                {format(m.downloadCode)}
              </Button>
              {restoreButton}
            </>
          }
          phoneActions={versionsButton}
          phoneMenu={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={format(m.moreActions)}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onBack}>{format(m.backToDraft)}</DropdownMenuItem>
                <DropdownMenuItem disabled={version === undefined} onSelect={download}>
                  {format(m.downloadCode)}
                </DropdownMenuItem>
                {info === null ? null : (
                  <DropdownMenuItem onSelect={() => onEditInfo(info)}>
                    {format(m.versionInfoEdit)}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      }
      source={source}
      tryRun={tryRun(false)}
      tryLabel={format(m.tryTitle)}
      panelTabs={panelTabs}
      panelTab={panelTab}
      onPanelTab={setPanelTab}
      panelLabel={format(m.releaseDetails)}
      phoneTabs={[
        { value: 'source', label: format(m.phoneSourceTab), content: source },
        { value: 'try', label: format(m.tryTitle), content: tryRun(true) },
        ...panelTabs,
      ]}
      phoneTab={phoneTab}
      onPhoneTab={setPhoneTab}
      gate={{
        label: format(m.historyTitle),
        tone: report.length > 0 && passed === report.length ? 'good' : 'quiet',
        words: displayName,
      }}
      foot={restoreButton}
    >
      {drawers}
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
