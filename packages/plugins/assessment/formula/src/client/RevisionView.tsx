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
import type { NormalizedInputSchema } from '@qualy/value-schema'
import { materializeInput, type FieldDraft } from '@qualy/web-value-form/model'
import { DownloadIcon, HistoryIcon, LockIcon, MoreHorizontalIcon, Undo2Icon } from 'lucide-react'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { fullWhen } from './library-styles.ts'
import { LazyFormulaSourceViewer } from './lazy-editors.ts'
import { inputIssueWords, inputSummaryOf } from './report-words.ts'
import { TryRunPanel, type TryOutcome } from './TryRunPanel.tsx'
import { SideHead, WorkbenchBar, WorkbenchLayout, type SideTab } from './WorkbenchLayout.tsx'
import { workbenchStyles as w } from './workbench-styles.ts'

// One saved state of the draft, as it was saved: its source and its examples,
// read-only. It is a draft, not a publication, so a try compiles its source
// the way the draft's own try does. Restoring it does not rewind anything -
// it becomes the draft's newest revision, naming this one as where it came
// from.

const styles = stylex.create({
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
  sourceFill: { display: 'flex', minHeight: '18rem', flexGrow: 1, flexDirection: 'column' },
})

interface Compiled {
  readonly inputSchema: NormalizedInputSchema
}

export function RevisionView({
  functionId,
  functionName,
  revisionNo,
  draftRevision,
  archived,
  narrow,
  titleRef,
  lease,
  history,
  sideTab,
  onSideTab,
  onBack,
  onRestore,
  restoring,
}: {
  readonly functionId: string
  readonly functionName: string
  readonly revisionNo: number
  /** the revision the draft is at now: restoring it would change nothing */
  readonly draftRevision: number
  readonly archived: boolean
  readonly narrow: boolean
  readonly titleRef: (node: HTMLElement | null) => void
  /** the page's editor lease, which the read-only source hangs on */
  readonly lease: string
  readonly history: ReactNode
  readonly sideTab: SideTab
  readonly onSideTab: (tab: SideTab) => void
  readonly onBack: () => void
  readonly onRestore: (revisionNo: number) => void
  readonly restoring: boolean
}) {
  const api = useApi(formulaApi)
  const run = useRunApi()
  const query = useApiQuery(formulaApi)
  const { format, formatError, locale } = useI18n()
  const [panelTab, setPanelTab] = useState('examples')
  const [phoneTab, setPhoneTab] = useState('source')
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({})
  const [issues, setIssues] = useState<ReadonlyMap<string, string> | undefined>(undefined)
  const [result, setResult] = useState<{ outcome: TryOutcome; forCase: string } | null>(null)
  const [running, setRunning] = useState(false)

  const detail = useQuery(
    query.assessmentFormula.getFormulaDraftRevision.queryOptions({
      params: { functionId, revisionNo: String(revisionNo) },
    }),
  )
  const revision = detail.data?.revision
  const current = revisionNo === draftRevision
  const label = format(m.revisionNumber, { number: revisionNo })
  const blank = revision !== undefined && revision.sourceTs.trim() === ''

  // the structure the saved source declares, asked only once it is on screen
  const compiled = useQuery({
    queryKey: ['assessment-formula', 'revision-structure', functionId, revisionNo],
    queryFn: () =>
      run(
        api.assessmentFormula.previewFormulaDraft({
          params: { functionId },
          payload: { sourceTs: revision!.sourceTs },
        }),
      ) as Promise<Compiled>,
    enabled: revision !== undefined && !blank,
    retry: false,
    staleTime: Infinity,
  })

  const download = () => {
    if (revision === undefined) return
    const filename = fileNameOf([functionName, label], '.ts')
    downloadText({ filename, text: revision.sourceTs, type: 'text/typescript;charset=utf-8' })
    toast.success(format(m.downloaded, { file: filename }))
  }

  const runTry = async () => {
    const schema = compiled.data?.inputSchema
    if (schema === undefined || revision === undefined) return
    const frozenDrafts = { ...drafts }
    const materialized = materializeInput(schema, frozenDrafts)
    if (materialized.value === null) {
      setIssues(inputIssueWords(format, schema, materialized.issues))
      return
    }
    setIssues(undefined)
    setRunning(true)
    try {
      const answered = (await run(
        api.assessmentFormula.evaluateFormulaDraft({
          params: { functionId },
          payload: {
            sourceTs: revision.sourceTs,
            cases: [{ clientId: 'try', input: materialized.value }],
          },
        }),
      )) as { cases: readonly TryOutcome[] }
      setResult({ outcome: answered.cases[0] ?? {}, forCase: JSON.stringify(frozenDrafts) })
    } catch (error) {
      toast.error(formatError(error))
    } finally {
      setRunning(false)
    }
  }

  const origin = (): string => {
    if (revision === undefined) return ''
    switch (revision.origin) {
      case 'created':
        return format(m.revisionCreated)
      case 'saved':
        return format(m.revisionSaved)
      case 'copied-from-template':
        return format(m.revisionCopied)
      case 'migration':
        return format(m.revisionMigration)
      case 'restored-from-version':
        return format(m.revisionRestoredRelease, {
          name:
            revision.sourceVersion === null
              ? ''
              : (revision.sourceVersion.releaseName ??
                format(m.releaseOrdinal, { number: revision.sourceVersion.versionNo })),
        })
      case 'restored-from-draft':
        return format(m.revisionRestoredRevision, { number: revision.sourceDraftRevisionNo ?? 0 })
    }
  }

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
    revision === undefined ? (
      pending
    ) : blank ? (
      <div {...stylex.props(w.emptyFill)}>
        <EmptyRow>{format(m.revisionEmptySource)}</EmptyRow>
      </div>
    ) : (
      <div {...stylex.props(styles.sourceFill)}>
        <Suspense fallback={pending}>
          <LazyFormulaSourceViewer
            functionId={functionId}
            lease={lease}
            name={`revision-${String(revisionNo)}`}
            source={revision.sourceTs}
            label={format(m.revisionSource)}
            readOnlyLabel={format(m.readOnly)}
            data-testid="formula-revision-source"
          />
        </Suspense>
      </div>
    )

  const tryRun = (
    <>
      <SideHead title={format(m.tryTitle)} column />
      <TryRunPanel
        schema={compiled.data?.inputSchema ?? null}
        pending={
          blank
            ? { state: 'blank', words: format(m.compileBlank), working: false, off: false }
            : compiled.isError
              ? {
                  state: 'refused',
                  words: format(m.structureRefused),
                  working: false,
                  off: true,
                }
              : {
                  state: 'loading',
                  words: format(m.structureLoading),
                  working: true,
                  off: false,
                }
        }
        drafts={drafts}
        onDraft={(name, draft) => setDrafts({ ...drafts, [name]: draft })}
        issues={issues}
        disabled={false}
        running={running}
        result={
          result === null
            ? null
            : { outcome: result.outcome, fresh: result.forCase === JSON.stringify(drafts) }
        }
        onRun={() => void runTry()}
      />
    </>
  )

  const examples =
    revision === undefined ? null : revision.tests.length === 0 ? (
      <div {...stylex.props(w.emptyFill)}>
        <EmptyRow>{format(m.revisionNoExamples)}</EmptyRow>
      </div>
    ) : (
      <table data-testid="formula-revision-examples" {...stylex.props(w.reportTable)}>
        <thead>
          <tr>
            <th {...stylex.props(w.reportHead)}>{format(m.testName)}</th>
            <th {...stylex.props(w.reportHead)}>{format(m.examplesInputColumn)}</th>
            <th {...stylex.props(w.reportHead)}>{format(m.examplesExpectedColumn)}</th>
          </tr>
        </thead>
        <tbody>
          {revision.tests.map((test, index) => (
            <tr key={index}>
              <td {...stylex.props(w.reportCell)}>
                {test.name === '' ? format(m.exampleUnnamed) : test.name}
              </td>
              <td {...stylex.props(w.reportCell, w.wrapMono, w.quiet)}>
                {inputSummaryOf(test.input)}
              </td>
              <td {...stylex.props(w.reportCell, w.mono)}>
                {test.expected === '' ? '—' : test.expected}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )

  const details =
    revision === undefined ? null : (
      <dl data-testid="formula-revision-details" {...stylex.props(w.facts)}>
        {(
          [
            [m.revisionOrigin, origin()],
            [m.revisionSavedAt, fullWhen(revision.savedAt, locale)],
            [m.revisionSavedBy, revision.savedByName ?? format(m.templatesAuthorUnknown)],
            [m.envSourceSha, revision.sourceSha256],
          ] as const
        ).map(([name, value]) => (
          <div key={name.id} {...stylex.props(w.fact)}>
            <dt {...stylex.props(w.factLabel)}>{format(name)}</dt>
            <dd {...stylex.props(w.factValue, name === m.envSourceSha && w.wrapMono)}>{value}</dd>
          </div>
        ))}
      </dl>
    )

  const scroll = (node: ReactNode) => <div {...stylex.props(w.panelScroll)}>{node}</div>
  const restoreDisabled = archived || restoring || current || revision === undefined
  const restoreButton = (
    <Button
      size="sm"
      data-testid="formula-revision-restore"
      disabled={restoreDisabled}
      onClick={() => onRestore(revisionNo)}
    >
      <HistoryIcon aria-hidden />
      {format(m.revisionRestore)}
    </Button>
  )

  return (
    <WorkbenchLayout
      narrow={narrow}
      testId="formula-revision-view"
      status="revision"
      bar={
        <WorkbenchBar
          narrow={narrow}
          backLabel={format(m.listTitle)}
          titleRef={titleRef}
          title={<span {...stylex.props(w.title)}>{functionName}</span>}
          badge={
            <span {...stylex.props(w.standing, w.standingOutline)}>
              <LockIcon size={11} aria-hidden />
              {format(m.readOnly)}
            </span>
          }
          status={
            <>
              <span>{label}</span>
              {current ? (
                <span {...stylex.props(w.standing, w.standingQuiet)}>
                  {format(m.revisionCurrent)}
                </span>
              ) : null}
            </>
          }
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={onBack}>
                <Undo2Icon aria-hidden />
                {format(m.backToDraft)}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={revision === undefined || blank}
                onClick={download}
              >
                <DownloadIcon aria-hidden />
                {format(m.downloadCode)}
              </Button>
              {restoreButton}
            </>
          }
          phoneMenu={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={format(m.moreActions)}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onBack}>{format(m.backToDraft)}</DropdownMenuItem>
                <DropdownMenuItem disabled={revision === undefined || blank} onSelect={download}>
                  {format(m.downloadCode)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      }
      source={source}
      tryRun={tryRun}
      history={history}
      sideTab={sideTab}
      onSideTab={onSideTab}
      tryLabel={format(m.tryTitle)}
      historyLabel={format(m.historyTitle)}
      panelTabs={[
        {
          value: 'examples',
          label: format(m.testsTitle),
          count: revision?.tests.length ?? 0,
          content: scroll(examples),
        },
        { value: 'details', label: format(m.revisionInfo), content: scroll(details) },
      ]}
      panelTab={panelTab}
      onPanelTab={setPanelTab}
      panelLabel={format(m.revisionInfo)}
      phoneTabs={[
        { value: 'source', label: format(m.phoneSourceTab), content: source },
        { value: 'try', label: format(m.tryTitle), content: tryRun },
        {
          value: 'details',
          label: format(m.revisionInfo),
          count: revision?.tests.length ?? 0,
          content: (
            <>
              <SideHead title={format(m.testsTitle)} />
              {examples}
              <SideHead title={format(m.revisionInfo)} />
              {details}
            </>
          ),
        },
        { value: 'history', label: format(m.historyTitle), content: history },
      ]}
      phoneTab={phoneTab}
      onPhoneTab={setPhoneTab}
      gate={
        <>
          <span {...stylex.props(styles.gateText)}>{label}</span>
          {restoreButton}
        </>
      }
    />
  )
}
