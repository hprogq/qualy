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
import { draftsFromStored, materializeInput, type FieldDraft } from '@qualy/web-value-form/model'
import { useTryRecords } from './try-records.ts'
import { DownloadIcon, HistoryIcon, LockIcon, MoreHorizontalIcon } from 'lucide-react'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { fullWhen } from './library-styles.ts'
import { LazyFormulaSourceViewer } from './lazy-editors.ts'
import { inputIssueWords, inputSummaryOf } from './report-words.ts'
import { TryRunPanel, type TryOutcome } from './TryRunPanel.tsx'
import { TryRecordsDrawer } from './TryRecordsDrawer.tsx'
import { WorkbenchBar, WorkbenchLayout } from './WorkbenchLayout.tsx'
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
  statusName: {
    minWidth: 0,
    maxWidth: '24rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusRule: { width: 1, height: 10, flexShrink: 0, backgroundColor: tokens.border },
  sourceFill: { display: 'flex', minHeight: '18rem', flexGrow: 1, flexDirection: 'column' },
  wide: { width: '100%' },
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
  versionsButton,
  drawers,
  motion,
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
  /** the bar's way into the versions, which the page owns */
  readonly versionsButton: ReactNode
  /** the drawers the page keeps open across views */
  readonly drawers: ReactNode
  /** set when this state was opened from inside the page rather than linked to */
  readonly motion?: 'forward'
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
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [ranAt, setRanAt] = useState<number | null>(null)

  // what this browser remembers trying against this saved revision
  const tryRecords = useTryRecords(functionId, `revision/${String(revisionNo)}`)
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

  const tryRun = (phone: boolean) => (
    <TryRunPanel
      title={format(m.tryTitle)}
      narrow={phone}
      status={
        compiled.data === undefined
          ? { state: 'loading', tone: 'working', words: format(m.structureLoading) }
          : { state: 'synced', tone: 'quiet', words: format(m.structureSynced) }
      }
      schema={compiled.data?.inputSchema ?? null}
      pending={
        blank
          ? { state: 'blank', words: format(m.compileBlank), working: false, off: false }
          : compiled.isError
            ? { state: 'refused', words: format(m.structureRefused), working: false, off: true }
            : { state: 'loading', words: format(m.structureLoading), working: true, off: false }
      }
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
                {test.expected === '' ? format(m.expectedNone) : test.expected}
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
      size={narrow ? 'lg' : 'sm'}
      data-testid="formula-revision-restore"
      disabled={restoreDisabled}
      onClick={() => onRestore(revisionNo)}
      className={narrow ? stylex.props(styles.wide).className : undefined}
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
      {...(motion === undefined ? {} : { motion })}
      bar={
        <WorkbenchBar
          narrow={narrow}
          frozen
          backLabel={format(m.backToDraft)}
          onBack={onBack}
          titleRef={titleRef}
          title={<span {...stylex.props(w.title)}>{label}</span>}
          badge={
            <>
              <span {...stylex.props(w.standing, w.standingOutline)}>
                <LockIcon size={11} aria-hidden />
                {format(m.readOnly)}
              </span>
              {current ? (
                <span {...stylex.props(w.standing, w.standingQuiet)}>
                  {format(m.revisionCurrent)}
                </span>
              ) : null}
            </>
          }
          status={
            <>
              <span {...stylex.props(styles.statusName)}>{functionName}</span>
              {revision === undefined ? null : (
                <>
                  <span aria-hidden {...stylex.props(styles.statusRule)} />
                  <span>{origin()}</span>
                </>
              )}
            </>
          }
          actions={
            <>
              {versionsButton}
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
                <DropdownMenuItem disabled={revision === undefined || blank} onSelect={download}>
                  {format(m.downloadCode)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      }
      source={source}
      tryRun={tryRun(false)}
      tryLabel={format(m.tryTitle)}
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
        { value: 'try', label: format(m.tryTitle), content: tryRun(true) },
        {
          value: 'examples',
          label: format(m.testsTitle),
          count: revision?.tests.length ?? 0,
          content: scroll(examples),
        },
        { value: 'details', label: format(m.revisionInfo), content: scroll(details) },
      ]}
      phoneTab={phoneTab}
      onPhoneTab={setPhoneTab}
      gate={{
        label: format(m.historyTitle),
        tone: 'quiet',
        words: current ? format(m.revisionCurrent) : origin(),
      }}
      foot={restoreButton}
    >
      {drawers}
      <TryRecordsDrawer
        open={recordsOpen}
        onOpenChange={setRecordsOpen}
        narrow={narrow}
        records={tryRecords.records}
        schema={compiled.data?.inputSchema ?? null}
        onPick={(record) => {
          const schema = compiled.data?.inputSchema
          if (schema === undefined) return
          const picked = draftsFromStored(schema, record.input)
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
