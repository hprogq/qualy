import * as stylex from '@stylexjs/stylex'
import { Suspense, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoadFailure, useApi, useApiQuery, useLoadFailure, useRunApi } from '@qualy/web-runtime'
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

import { fullWhen } from './library-styles.ts'
import { LazyFormulaSourceViewer } from './lazy-editors.ts'
import { inputIssueWords, inputSummaryOf } from './report-words.ts'
import { TryRunPanel, type TryOutcome } from './TryRunPanel.tsx'
import { TryRecordsDrawer } from './TryRecordsDrawer.tsx'
import { WorkbenchBar, WorkbenchLayout } from './WorkbenchLayout.tsx'
import { workbenchStyles as w } from './workbench-styles.ts'
import * as m from '#messages'

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
  const { formatError, locale } = useI18n()
  const [panelTab, setPanelTab] = useState('examples')
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

  // what this browser remembers trying against this saved revision
  const tryRecords = useTryRecords(functionId, `revision/${String(revisionNo)}`)
  const detail = useQuery(
    query.assessmentFormula.getFormulaDraftRevision.queryOptions({
      params: { functionId, revisionNo: String(revisionNo) },
    }),
  )
  const revision = detail.data?.revision
  const current = revisionNo === draftRevision
  const label = m.history_revisionNumber({ number: revisionNo })
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
    toast.success(m.editor_downloaded({ file: filename }))
  }

  const runTry = async () => {
    const schema = compiled.data?.inputSchema
    if (schema === undefined || revision === undefined) return
    const frozenDrafts = { ...drafts }
    const materialized = materializeInput(schema, frozenDrafts)
    if (materialized.value === null) {
      // the fields mark themselves, but on a long contract they do it
      // somewhere the reader is not looking
      const words = inputIssueWords(schema, materialized.issues)
      setIssues(words)
      setVerdict({ at: Date.now(), kind: 'refused' })
      toast.error(m.editor_runNeedsFields({ count: words.size }))
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
      setVerdict({ at: Date.now(), kind: outcome.actual === undefined ? 'failed' : 'ran' })
    } catch (error) {
      toast.error(formatError(error))
      setVerdict({ at: Date.now(), kind: 'failed' })
    } finally {
      setRunning(false)
    }
  }

  const origin = (): string => {
    if (revision === undefined) return ''
    switch (revision.origin) {
      case 'created':
        return m.history_revisionCreated()
      case 'saved':
        return m.history_revisionSaved()
      case 'copied-from-template':
        return m.history_revisionCopied()
      case 'migration':
        return m.history_revisionMigration()
      case 'restored-from-version':
        return m.history_revisionRestoredRelease({
          name:
            revision.sourceVersion === null
              ? ''
              : (revision.sourceVersion.releaseName ??
                m.history_releaseOrdinal({ number: revision.sourceVersion.versionNo })),
        })
      case 'restored-from-draft':
        return m.history_revisionRestoredRevision({ number: revision.sourceDraftRevisionNo ?? 0 })
    }
  }

  const loadFailure = useLoadFailure()
  const unreadable = (error: unknown) =>
    loadFailure.of(error, { missing: ['ASSESSMENT_FORMULA_DRAFT_REVISION_NOT_FOUND'] })
  const retryable = detail.isError && unreadable(detail.error).retryable
  // A save that is not there - an address somebody kept, one deleted
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
    revision === undefined ? (
      pending
    ) : blank ? (
      <div {...stylex.props(w.emptyFill)}>
        <EmptyRow>{m.revision_emptySource()}</EmptyRow>
      </div>
    ) : (
      <div {...stylex.props(styles.sourceFill)}>
        <Suspense fallback={pending}>
          <LazyFormulaSourceViewer
            functionId={functionId}
            lease={lease}
            name={`revision-${String(revisionNo)}`}
            source={revision.sourceTs}
            label={m.revision_source()}
            readOnlyLabel={m.history_readOnly()}
            data-testid="formula-revision-source"
          />
        </Suspense>
      </div>
    )

  const tryRun = (phone: boolean) => (
    <TryRunPanel
      title={m.editor_tryTitle()}
      narrow={phone}
      status={
        compiled.data === undefined
          ? { state: 'loading', tone: 'working', words: m.editor_structureLoading() }
          : { state: 'synced', tone: 'quiet', words: m.editor_structureSynced() }
      }
      schema={compiled.data?.inputSchema ?? null}
      pending={
        blank
          ? { state: 'blank', words: m.editor_compileBlank(), working: false, off: false }
          : compiled.isError
            ? { state: 'refused', words: m.editor_structureRefused(), working: false, off: true }
            : { state: 'loading', words: m.editor_structureLoading(), working: true, off: false }
      }
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

  const examples =
    revision === undefined ? null : revision.tests.length === 0 ? (
      <div {...stylex.props(w.emptyFill)}>
        <EmptyRow>{m.revision_noExamples()}</EmptyRow>
      </div>
    ) : (
      <table data-testid="formula-revision-examples" {...stylex.props(w.reportTable)}>
        <thead>
          <tr>
            <th {...stylex.props(w.reportHead)}>{m.editor_testName()}</th>
            <th {...stylex.props(w.reportHead)}>{m.examples_inputColumn()}</th>
            <th {...stylex.props(w.reportHead)}>{m.examples_expectedColumn()}</th>
          </tr>
        </thead>
        <tbody>
          {revision.tests.map((test, index) => (
            <tr key={index}>
              <td {...stylex.props(w.reportCell)}>
                {test.name === '' ? m.examples_unnamed() : test.name}
              </td>
              <td {...stylex.props(w.reportCell, w.wrapMono, w.quiet)}>
                {inputSummaryOf(test.input)}
              </td>
              <td {...stylex.props(w.reportCell, w.mono)}>
                {test.expected === '' ? m.examples_expectedNone() : test.expected}
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
            [m.revision_origin, origin()],
            [m.revision_savedAt, fullWhen(revision.savedAt, locale)],
            [m.revision_savedBy, revision.savedByName ?? m.templates_authorUnknown()],
            [m.release_envSourceSha, revision.sourceSha256],
          ] as const
        ).map(([name, value]) => (
          <div key={name()} {...stylex.props(w.fact)}>
            <dt {...stylex.props(w.factLabel)}>{name()}</dt>
            <dd {...stylex.props(w.factValue, name === m.release_envSourceSha && w.wrapMono)}>
              {value}
            </dd>
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
      {m.revision_restore()}
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
          backLabel={m.history_backToDraft()}
          onBack={onBack}
          titleRef={titleRef}
          title={<span {...stylex.props(w.title)}>{label}</span>}
          badge={
            <>
              <span {...stylex.props(w.standing, w.standingOutline)}>
                <LockIcon size={11} aria-hidden />
                {m.history_readOnly()}
              </span>
              {current ? (
                <span {...stylex.props(w.standing, w.standingQuiet)}>
                  {m.history_revisionCurrent()}
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
                <DropdownMenuItem disabled={revision === undefined || blank} onSelect={download}>
                  {m.history_downloadCode()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      }
      source={source}
      tryRun={tryRun(false)}
      tryLabel={m.editor_tryTitle()}
      panelTabs={[
        {
          value: 'examples',
          label: m.editor_tests(),
          count: revision?.tests.length ?? 0,
          content: scroll(examples),
        },
        { value: 'details', label: m.revision_info(), content: scroll(details) },
      ]}
      panelTab={panelTab}
      onPanelTab={setPanelTab}
      panelLabel={m.revision_info()}
      phoneTabs={[
        { value: 'source', label: m.editor_phoneSourceTab(), content: source },
        { value: 'try', label: m.editor_tryTitle(), content: tryRun(true) },
        {
          value: 'examples',
          label: m.editor_tests(),
          count: revision?.tests.length ?? 0,
          content: scroll(examples),
        },
        { value: 'details', label: m.revision_info(), content: scroll(details) },
      ]}
      phoneTab={phoneTab}
      onPhoneTab={setPhoneTab}
      gate={{
        label: m.history_title(),
        tone: 'quiet',
        words: current ? m.history_revisionCurrent() : origin(),
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
