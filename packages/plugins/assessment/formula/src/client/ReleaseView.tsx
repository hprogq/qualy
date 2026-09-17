import * as stylex from '@stylexjs/stylex'
import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { EmptyRow } from '@qualy/ui/empty-row'
import { Spinner } from '@qualy/ui/spinner'
import { downloadText, fileNameOf } from '@qualy/ui/download'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import type { NormalizedAtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'
import { DownloadIcon, FilePenLineIcon, MoreHorizontalIcon, Undo2Icon } from 'lucide-react'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { fullWhen } from './library-styles.ts'
import { inputSummaryOf, outcomeWords, type OutcomeLike } from './report-words.ts'
import { ContractTable } from './ContractTable.tsx'
import { SourceView } from './SourceView.tsx'
import { VersionSharing } from './VersionSharing.tsx'
import { SideHead, WorkbenchBar, WorkbenchLayout, type WorkbenchTab } from './WorkbenchLayout.tsx'
import { workbenchStyles as w } from './workbench-styles.ts'

// One publication of a formula, as it was frozen.
//
// Everything here is read off the version row: its source, its examples and
// the report they produced, its contract and the toolchain that proved it.
// Nothing is compiled again - putting yesterday's source through today's
// compiler would show a different world and call it this publication.

const styles = stylex.create({
  info: { display: 'flex', flexDirection: 'column', gap: 10, paddingInline: 16, paddingBottom: 14 },
  releaseName: { margin: 0, fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' },
  releaseNotes: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    color: tokens.surfaceMutedForeground,
  },
  infoFacts: { display: 'flex', flexDirection: 'column', gap: 8, margin: 0 },
  infoFact: { display: 'flex', gap: 10, fontSize: 12.5 },
  infoLabel: { flexShrink: 0, width: '4.5rem', color: tokens.mutedForeground },
  infoValue: { margin: 0, minWidth: 0, overflowWrap: 'anywhere' },
  sub: {
    margin: 0,
    marginTop: 4,
    fontSize: 12,
    fontWeight: 600,
    color: tokens.surfaceMutedForeground,
  },
  loading: {
    display: 'flex',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  gateText: {
    minWidth: 0,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
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
  history,
  onBack,
  onRestore,
  restoring,
}: {
  readonly functionId: string
  readonly functionName: string
  readonly versionNo: number
  readonly latestVersionNo: number | null
  readonly archived: boolean
  readonly narrow: boolean
  readonly titleRef: (node: HTMLElement | null) => void
  readonly history: ReactNode
  readonly onBack: () => void
  readonly onRestore: (release: { versionNo: number; name: string }) => void
  readonly restoring: boolean
}) {
  const query = useApiQuery(formulaApi)
  const { format, formatError, locale } = useI18n()
  const [panelTab, setPanelTab] = useState('report')
  const [phoneTab, setPhoneTab] = useState('source')

  const detail = useQuery(
    query.assessmentFormula.getFormulaVersion.queryOptions({
      params: { functionId, versionNo: String(versionNo) },
    }),
  )
  const version = detail.data?.version
  const title = version?.releaseName ?? (version === undefined ? '' : format(m.releaseUnnamed))
  const displayName =
    version === undefined
      ? ''
      : (version.releaseName ?? format(m.releaseOrdinal, { number: version.versionNo }))

  const download = () => {
    if (version === undefined) return
    downloadText({
      filename: fileNameOf([functionName, displayName], '.ts'),
      text: version.sourceTs,
      type: 'text/typescript;charset=utf-8',
    })
  }
  const restore = () => onRestore({ versionNo, name: displayName })

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
      <>
        <div {...stylex.props(w.paneHead)}>
          <span {...stylex.props(w.paneLabel)}>{format(m.releaseSource)}</span>
          <span {...stylex.props(w.spring)} />
          <span {...stylex.props(w.paneNote)}>{format(m.readOnly)}</span>
        </div>
        <SourceView
          source={version.sourceTs}
          data-testid="formula-release-source"
          aria-label={format(m.releaseSource)}
          xstyle={w.paneSource}
        />
      </>
    )

  const info =
    version === undefined ? null : (
      <>
        <SideHead title={format(m.releaseInfo)} />
        <div {...stylex.props(styles.info)} data-testid="formula-release-info">
          <p {...stylex.props(styles.releaseName)}>{title}</p>
          {version.releaseNotes === null ? null : (
            <p {...stylex.props(styles.releaseNotes)}>{version.releaseNotes}</p>
          )}
          <dl {...stylex.props(styles.infoFacts)}>
            <div {...stylex.props(styles.infoFact)}>
              <dt {...stylex.props(styles.infoLabel)}>{format(m.releaseOrdinalLabel)}</dt>
              <dd {...stylex.props(styles.infoValue)}>
                {format(m.releaseOrdinal, { number: version.versionNo })}
              </dd>
            </div>
            <div {...stylex.props(styles.infoFact)}>
              <dt {...stylex.props(styles.infoLabel)}>{format(m.templatesPublishedColumn)}</dt>
              <dd {...stylex.props(styles.infoValue)}>{fullWhen(version.publishedAt, locale)}</dd>
            </div>
            <div {...stylex.props(styles.infoFact)}>
              <dt {...stylex.props(styles.infoLabel)}>{format(m.releasePublisher)}</dt>
              <dd {...stylex.props(styles.infoValue)}>
                {version.publishedByName ?? format(m.templatesAuthorUnknown)}
              </dd>
            </div>
          </dl>
          <h3 {...stylex.props(styles.sub)}>{format(m.releaseSharing)}</h3>
          <VersionSharing functionId={functionId} versionNo={version.versionNo} />
        </div>
      </>
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
                <td {...stylex.props(w.reportCell, w.mono)}>{row.actual ?? '—'}</td>
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

  const environment =
    version === undefined ? null : (
      <dl data-testid="formula-release-environment" {...stylex.props(w.facts)}>
        {(
          [
            [m.envTypescript, version.typescriptVersion],
            [m.envEsbuild, version.esbuildVersion],
            [m.envQuickjs, version.quickjsEngineVersion],
            [m.envFormulaAbi, String(version.formulaAbiVersion)],
            [m.envSandboxAbi, String(version.sandboxAbiVersion)],
            [m.envValueSchema, String(version.valueSchemaProfileVersion)],
            [m.envRegex, String(version.regexProfileVersion)],
            [
              m.envSourcePolicy,
              `${String(version.sourcePolicyVersion)} (${version.sourcePolicyParserVersion})`,
            ],
            [m.envAuthoringBuild, version.authoringBuildId],
            [m.envRuntimeBuild, version.sandboxRuntimeBuildId],
            [m.envSourceSha, version.sourceSha256],
            [m.envRuntimeSha, version.runtimeSha256],
            [m.envContractSha, version.contractSha256],
            [m.envFormulaRuntimeSha, version.formulaRuntimeSha256],
          ] as const
        ).map(([label, value]) => (
          <div key={label.id} {...stylex.props(w.fact)}>
            <dt {...stylex.props(w.factLabel)}>{format(label)}</dt>
            <dd {...stylex.props(w.factValue, w.wrapMono)}>{value}</dd>
          </div>
        ))}
      </dl>
    )

  const scroll = (node: ReactNode) => <div {...stylex.props(w.panelScroll)}>{node}</div>

  const actions = (
    <>
      <Button variant="ghost" size="sm" onClick={onBack}>
        <Undo2Icon aria-hidden />
        {format(m.backToDraft)}
      </Button>
      <Button variant="outline" size="sm" disabled={version === undefined} onClick={download}>
        <DownloadIcon aria-hidden />
        {format(m.downloadCode)}
      </Button>
      <Button
        size="sm"
        data-testid="formula-release-restore"
        disabled={archived || restoring || version === undefined}
        onClick={restore}
      >
        <FilePenLineIcon aria-hidden />
        {format(m.releaseRestore)}
      </Button>
    </>
  )

  const phoneMenu = (
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
      </DropdownMenuContent>
    </DropdownMenu>
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
      bar={
        <WorkbenchBar
          narrow={narrow}
          backLabel={format(m.listTitle)}
          titleRef={titleRef}
          title={<span {...stylex.props(w.title)}>{functionName}</span>}
          badge={
            <span {...stylex.props(w.standing, w.standingOutline)}>
              {format(m.releaseReadOnlyBadge)}
            </span>
          }
          status={
            version === undefined ? undefined : (
              <>
                <span>{displayName}</span>
                {versionNo === latestVersionNo ? <span>{format(m.versionLatest)}</span> : null}
              </>
            )
          }
          actions={actions}
          phoneMenu={phoneMenu}
        />
      }
      source={source}
      side={info}
      history={history}
      panelTabs={panelTabs}
      panelTab={panelTab}
      onPanelTab={setPanelTab}
      panelLabel={format(m.releaseInfo)}
      phoneTabs={[
        { value: 'source', label: format(m.phoneSourceTab), content: source },
        {
          value: 'info',
          label: format(m.releaseInfo),
          content: (
            <>
              {info}
              <SideHead title={format(m.releaseContractTab)} />
              {contract}
              <SideHead title={format(m.releaseEnvironmentTab)} />
              {environment}
            </>
          ),
        },
        {
          value: 'report',
          label: format(m.releaseReportTab),
          count: report.length,
          content: reportTable,
        },
        { value: 'history', label: format(m.historyTitle), content: history },
      ]}
      phoneTab={phoneTab}
      onPhoneTab={setPhoneTab}
      gate={
        <>
          <span {...stylex.props(styles.gateText)}>{displayName}</span>
          <Button
            size="sm"
            disabled={archived || restoring || version === undefined}
            onClick={restore}
          >
            <FilePenLineIcon aria-hidden />
            {format(m.releaseRestore)}
          </Button>
        </>
      }
    />
  )
}
