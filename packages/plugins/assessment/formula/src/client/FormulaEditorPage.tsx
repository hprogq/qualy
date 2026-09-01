import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useApi, useApiQuery, usePageRouteParams, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Badge } from '@qualy/ui/badge'
import { toast } from '@qualy/ui/toast'
import { Field, PageHeader, Panel } from '@qualy/ui/admin'
import { Spinner } from '@qualy/ui/spinner'
import { constraintOf, parameterSchemaAt, type AtomicSchema } from '@qualy/value-schema'
import { validateValue } from '@qualy/value-schema/validate'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'
import { useDraftPreview, type DraftContract } from './use-draft-preview.ts'
import { AtomicValueField, InputValueForm } from '@qualy/web-value-form/InputValueForm'
import {
  draftsFromStored,
  materializeField,
  materializeInput,
  type FieldDraft,
} from '@qualy/web-value-form/model'

// Monaco rides its own chunk: the list page, the app shell and even this
// page's first paint stay free of it - the editor arrives when the source
// panel does
const FormulaCodeEditor = lazy(() => import('./FormulaCodeEditor.tsx'))

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem' },
  source: {
    width: '100%',
    minHeight: '26rem',
    borderRadius: '0.5rem',
    border: '1px solid var(--q-border)',
    background: 'var(--q-surface)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    color: 'var(--q-surface-muted-foreground)',
    fontSize: '0.8125rem',
  },
  actions: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' },
  testGrid: { display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '0.75rem' },
  testRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr auto',
    gap: '0.5rem',
    alignItems: 'center',
  },
  testCase: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '0.75rem',
    border: '1px solid var(--q-border)',
    borderRadius: '0.5rem',
  },
  problemLine: { fontSize: '0.75rem', color: 'var(--q-danger, #b91c1c)', margin: 0 },
  reportTable: { width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' },
  reportCell: { padding: '0.375rem 0.5rem', borderTop: '1px solid var(--q-border)' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  hint: { fontSize: '0.8125rem', color: 'var(--q-surface-muted-foreground)' },
})

interface DraftTest {
  /** client-local identity: react keys, drafts, results and clientIds all
   * ride this, so copying or deleting a row can never shift state onto a
   * neighbour. Not persisted (yet) - reloading reseeds fresh keys. */
  key: string
  name: string
  inputText: string
  expected: string
}

const newTestKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** the wire/compare projection: identity is local, never sent or compared */
const bareTests = (tests: readonly DraftTest[]) => tests.map(({ key: _key, ...rest }) => rest)

/** a refusal raised by this screen's own checks, worded here, never generic */
class LocalFinding extends Error {}

interface PublishFindings {
  readonly diagnostics?: readonly {
    line: number
    column: number
    code: string
    message: string
  }[]
  readonly report?: readonly {
    name: string
    passed: boolean
    expected: string
    actual?: string
    problems?: readonly {
      at: 'input' | 'expected' | 'output'
      parameter?: string
      reason: string
      constraint?: string
    }[]
    refusal?: string
    defect?: string
  }[]
  readonly issues?: readonly { path: string; reason: string }[]
  /** the guest's own words when contract extraction itself threw */
  readonly detail?: string
}

type ReportRow = NonNullable<PublishFindings['report']>[number]
type ReportProblem = NonNullable<ReportRow['problems']>[number]

/** the structured data a refused publish carries, whichever refusal it was */
const findingsOf = (error: unknown): PublishFindings => {
  const carried = (error ?? {}) as PublishFindings
  return {
    ...(carried.diagnostics === undefined ? {} : { diagnostics: carried.diagnostics }),
    ...(carried.report === undefined ? {} : { report: carried.report }),
    ...(carried.issues === undefined ? {} : { issues: carried.issues }),
    ...(carried.detail === undefined ? {} : { detail: carried.detail }),
  }
}

export default function FormulaEditorPage() {
  const { functionId } = usePageRouteParams('functionId')
  const api = useApi(formulaApi)
  const run = useRunApi()
  const query = useApiQuery(formulaApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()

  const detail = useQuery(
    query.assessmentFormula.getFormulaFunction.queryOptions({ params: { functionId } }),
  )
  const fn = detail.data?.function
  const versions = detail.data?.versions ?? []
  // Where this draft was started from, when it was started from somebody
  // else's. A note about how it came to exist and nothing more: there is
  // no following the source, and no version of it to be behind.
  const copiedFrom = detail.data?.copiedFrom ?? null

  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [tests, setTests] = useState<DraftTest[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [findings, setFindings] = useState<PublishFindings>({})

  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  const [remoteMoved, setRemoteMoved] = useState(false)
  // bumps exactly when the buffer must ADOPT `source` (discard local, a
  // clean refetch); the editor never infers adoption from value changes
  const [editorSeed, setEditorSeed] = useState(0)

  // ---- the draft contract: what the CURRENT buffer compiles to ---------
  const fetchPreview = useCallback(
    (sourceTs: string) =>
      run(
        api.assessmentFormula.previewFormulaDraft({
          params: { functionId },
          payload: { sourceTs },
        }),
      ) as Promise<DraftContract>,
    [api, run, functionId],
  )
  const preview = useDraftPreview(fn === undefined ? null : source, fetchPreview, formatError)
  // screens render from the last contract that compiled; running and saving
  // tests take their authority from preview.current alone
  const contract = preview.lastGood?.contract ?? null

  // per-row form drafts; the row's inputText stays the stored truth and
  // the drafts are the editing view over it. A changed contract identity
  // re-derives every view (legal stored values survive verbatim).
  const [rowDrafts, setRowDrafts] = useState<Record<string, Record<string, FieldDraft>>>({})
  const [rowIssues, setRowIssues] = useState<Record<string, ReadonlyMap<string, string>>>({})
  const [tryDrafts, setTryDrafts] = useState<Record<string, FieldDraft>>({})
  const [tryIssues, setTryIssues] = useState<ReadonlyMap<string, string> | undefined>(undefined)
  interface RunOutcome {
    readonly passed?: boolean
    readonly actual?: string
    readonly refusal?: string
    readonly defect?: string
    readonly problems?: unknown
    /** the buffer this ran against */
    readonly forSource: string
    /** the case (input + expectation) this ran; edits make it stale too */
    readonly forCase: string
  }
  const [runResults, setRunResults] = useState<Record<string, RunOutcome>>({})
  const [tryResult, setTryResult] = useState<RunOutcome | null>(null)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    setRowDrafts({})
    setRowIssues({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract?.contractSha256])

  const fieldIssueText = (schema: AtomicSchema | undefined, reason: string): string => {
    switch (reason) {
      case 'required':
        return format(m.fieldRequired)
      case 'not-an-integer':
        return format(m.fieldNotInteger)
      case 'not-a-decimal':
        return format(m.fieldNotDecimal)
      default: {
        const constraint = schema === undefined ? undefined : constraintOf(schema, reason)
        return reasonText({
          at: 'input',
          reason,
          ...(constraint === undefined ? {} : { constraint }),
        })
      }
    }
  }

  const translateIssues = (
    schema: DraftContract['inputSchema'],
    issues: ReadonlyMap<string, string>,
  ): ReadonlyMap<string, string> =>
    new Map(
      [...issues].map(([field, reason]) => [
        field,
        fieldIssueText(field === '' ? undefined : parameterSchemaAt(schema, `/${field}`), reason),
      ]),
    )

  const rowByKey = (key: string): DraftTest | undefined => tests.find((one) => one.key === key)

  const storedInput = (row: DraftTest | undefined): unknown => {
    if (row === undefined) return undefined
    try {
      return JSON.parse(row.inputText === '' ? '{}' : row.inputText)
    } catch {
      return undefined
    }
  }

  /** what a result answered: the exact case content at run time */
  const caseFingerprint = (row: DraftTest): string => JSON.stringify([row.inputText, row.expected])

  /** the row's editing view: live drafts, or the stored value redrawn */
  const draftsOfRow = (row: DraftTest): Record<string, FieldDraft> =>
    rowDrafts[row.key] ??
    (contract === null ? {} : draftsFromStored(contract.inputSchema, storedInput(row)))

  const editRow = (row: DraftTest, name_: string, draft: FieldDraft) => {
    if (contract === null) return
    const next = { ...draftsOfRow(row), [name_]: draft }
    setRowDrafts((previous) => ({ ...previous, [row.key]: next }))
    const materialized = materializeInput(contract.inputSchema, next)
    if (materialized.value !== null) {
      setTests(
        tests.map((one) =>
          one.key === row.key ? { ...one, inputText: JSON.stringify(materialized.value) } : one,
        ),
      )
      setRowIssues((previous) => {
        const { [row.key]: _dropped, ...rest } = previous
        return rest
      })
      return
    }
    setRowIssues((previous) => ({
      ...previous,
      [row.key]: translateIssues(contract.inputSchema, materialized.issues),
    }))
  }

  /** the expected value judged against the output contract; '' = not yet given */
  const expectedIssueOf = (row: DraftTest, against: DraftContract | null): string | null => {
    if (against === null || row.expected === '') return null
    const outcome = materializeField(against.outputSchema, row.expected)
    if (outcome.kind === 'invalid') return fieldIssueText(against.outputSchema, outcome.reason)
    if (outcome.kind === 'empty') return null
    const wrong = validateValue(against.outputSchema, outcome.value)
    return wrong.length === 0 ? null : fieldIssueText(against.outputSchema, wrong[0]!.reason)
  }

  /** whether a row's STORED case satisfies a given contract, output included */
  const rowLegalAgainst = (row: DraftTest, against: DraftContract | null): boolean => {
    if (against === null) return true
    const stored = storedInput(row)
    if (stored === undefined) return false
    if (validateValue(against.inputSchema, stored).length > 0) return false
    return expectedIssueOf(row, against) === null
  }

  const rowLegal = (row: DraftTest): boolean => rowLegalAgainst(row, contract)

  // ---- one evaluator, always against a FROZEN snapshot -----------------
  // ensureFresh may resolve for a newer buffer than the click; the run then
  // uses that newer pair wholesale - schema and source always travel
  // together, and results are stamped with what they actually ran.
  interface RunSnapshot {
    readonly sourceTs: string
    readonly contract: DraftContract
  }
  const freezeForRun = async (): Promise<RunSnapshot | null> => {
    const fresh = await preview.ensureFresh()
    if (fresh.status !== 'ready') return null
    return { sourceTs: fresh.source, contract: fresh.contract }
  }

  const evaluate = async (
    sourceTs: string,
    cases: readonly { clientId: string; input: unknown; expected?: string }[],
  ) => {
    const outcome = (await run(
      api.assessmentFormula.evaluateFormulaDraft({
        params: { functionId },
        payload: { sourceTs, cases },
      }),
    )) as {
      cases: readonly {
        clientId: string
        passed?: boolean
        actual?: string
        refusal?: string
        defect?: string
        problems?: unknown
      }[]
    }
    return outcome.cases
  }

  const runRows = async (keys: readonly string[]) => {
    setRunning(true)
    setFailure(null)
    try {
      const snapshot = await freezeForRun()
      if (snapshot === null) return
      // capture each runnable row's content NOW; later edits mark results
      // stale rather than confusing what actually ran
      const frozen = keys
        .map((key) => rowByKey(key))
        .filter((row): row is DraftTest => row !== undefined)
        .map((row) => ({
          key: row.key,
          fingerprint: caseFingerprint(row),
          input: storedInput(row),
          expected: row.expected,
        }))
        .filter((row) => row.input !== undefined)
      if (frozen.length === 0) return
      const answers = await evaluate(
        snapshot.sourceTs,
        frozen.map((row) => ({
          clientId: row.key,
          input: row.input,
          ...(row.expected === '' ? {} : { expected: row.expected }),
        })),
      )
      const byKey = new Map(frozen.map((row) => [row.key, row]))
      setRunResults((previous) => {
        const next = { ...previous }
        for (const answer of answers) {
          const asked = byKey.get(answer.clientId)
          if (asked === undefined) continue
          next[answer.clientId] = {
            ...answer,
            forSource: snapshot.sourceTs,
            forCase: asked.fingerprint,
          }
        }
        return next
      })
    } catch (error) {
      setFailure(formatError(error))
    } finally {
      setRunning(false)
    }
  }

  const runTry = async () => {
    setRunning(true)
    setFailure(null)
    setTryIssues(undefined)
    try {
      const snapshot = await freezeForRun()
      if (snapshot === null) return
      const frozenDrafts = { ...tryDrafts }
      const materialized = materializeInput(snapshot.contract.inputSchema, frozenDrafts)
      if (materialized.value === null) {
        setTryIssues(translateIssues(snapshot.contract.inputSchema, materialized.issues))
        return
      }
      const answers = await evaluate(snapshot.sourceTs, [
        { clientId: 'try', input: materialized.value },
      ])
      setTryResult({
        ...answers[0]!,
        forSource: snapshot.sourceTs,
        forCase: JSON.stringify(frozenDrafts),
      })
    } catch (error) {
      setFailure(formatError(error))
    } finally {
      setRunning(false)
    }
  }

  /** a try result speaks for the current screen only while neither the
   * code nor the inputs moved; a stale actual may NOT become an expected */
  const tryStale = (outcome: RunOutcome): boolean =>
    outcome.forSource !== source || outcome.forCase !== JSON.stringify(tryDrafts)

  const saveTryAsCase = (expected: string) => {
    if (contract === null) return
    const materialized = materializeInput(contract.inputSchema, tryDrafts)
    if (materialized.value === null) {
      setTryIssues(translateIssues(contract.inputSchema, materialized.issues))
      return
    }
    setTests([
      ...tests,
      { key: newTestKey(), name: '', inputText: JSON.stringify(materialized.value), expected },
    ])
  }

  const loadIntoTry = (row: DraftTest) => {
    if (contract === null) return
    setTryDrafts(draftsFromStored(contract.inputSchema, storedInput(row)))
    setTryIssues(undefined)
    setTryResult(null)
  }

  const seededTests = (loaded: NonNullable<typeof fn>) =>
    loaded.draftTests.map((test) => ({
      key: newTestKey(),
      name: test.name,
      inputText: JSON.stringify(test.input),
      expected: test.expected,
    }))

  // the editor follows the server draft ONLY while it holds nothing of its
  // own: a refetch that arrives over unsaved edits (another admin saved)
  // must not overwrite them - it raises the banner and leaves the text alone
  useEffect(() => {
    if (fn === undefined) return
    const holdsEdits =
      baseRevision !== null &&
      (name.trim() !== fn.name ||
        source !== fn.draftSourceTs ||
        JSON.stringify(bareTests(tests)) !== JSON.stringify(bareTests(seededTests(fn))))
    if (baseRevision !== null && fn.draftRevision !== baseRevision && holdsEdits) {
      setRemoteMoved(true)
      return
    }
    setName(fn.name)
    setSource(fn.draftSourceTs)
    setTests(seededTests(fn))
    setBaseRevision(fn.draftRevision)
    setRemoteMoved(false)
    setEditorSeed((seed) => seed + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn?.id, fn?.draftRevision])

  const discardLocal = () => {
    if (fn === undefined) return
    setName(fn.name)
    setSource(fn.draftSourceTs)
    setTests(seededTests(fn))
    setBaseRevision(fn.draftRevision)
    setRemoteMoved(false)
    setEditorSeed((seed) => seed + 1)
  }

  type ParsedTests =
    | { readonly tests: { name: string; input: unknown; expected: string }[] }
    | { readonly invalidLabel: string }

  const parsedTests = (): ParsedTests => {
    const collected: { name: string; input: unknown; expected: string }[] = []
    for (const [index, test] of tests.entries()) {
      try {
        collected.push({
          name: test.name,
          input: JSON.parse(test.inputText === '' ? '{}' : test.inputText) as unknown,
          expected: test.expected,
        })
      } catch {
        return { invalidLabel: test.name === '' ? `#${index + 1}` : test.name }
      }
    }
    return { tests: collected }
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.assessmentFormula.key() })

  // the two dirts, apart on purpose: big code edits may leave cases
  // temporarily broken, and that must never hold the CODE hostage
  const nameDirty = (): boolean => (fn === undefined ? false : name.trim() !== fn.name)
  const sourceChanged = (): boolean => (fn === undefined ? false : source !== fn.draftSourceTs)
  const sourceDirty = (): boolean => nameDirty() || sourceChanged()
  const testsDirty = (): boolean =>
    fn === undefined
      ? false
      : JSON.stringify(bareTests(tests)) !== JSON.stringify(bareTests(seededTests(fn)))
  const dirty = (): boolean => sourceDirty() || testsDirty()

  /** every row satisfies a given contract, expectation included */
  const allRowsLegalAgainst = (against: DraftContract): boolean =>
    tests.every((row) => rowLegalAgainst(row, against))

  /** tests may only claim contract-checked when the preview is READY for
   * the exact buffer on screen; the lastGood convenience never qualifies */
  const testsSaveable = (): boolean =>
    preview.current.status === 'ready' &&
    preview.current.source === source &&
    allRowsLegalAgainst(preview.current.contract)

  interface SavePatch {
    readonly name: string | null
    readonly source: string | null
    readonly tests: { name: string; input: unknown; expected: string }[] | null
  }

  // a real PATCH: only what changed travels, so a clean save is a business
  // no-op instead of a new revision and a new audit row
  const saveEffect = (patch: SavePatch) =>
    run(
      api.assessmentFormula.updateFormulaDraft({
        params: { functionId },
        payload: {
          expectedDraftRevision: baseRevision ?? fn!.draftRevision,
          ...(patch.name === null ? {} : { name: patch.name }),
          ...(patch.source === null ? {} : { draftSourceTs: patch.source }),
          ...(patch.tests === null ? {} : { draftTests: patch.tests }),
        },
      }),
    )

  const save = useMutation({
    mutationFn: (patch: SavePatch) => saveEffect(patch),
    onMutate: () => setFailure(null),
    onSuccess: async () => {
      toast.success(format(m.saved))
      await refresh()
    },
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  // local validation stays OUT of the mutation: a malformed example is this
  // screen's own finding, named precisely, never blurred into the generic
  // api-failure copy (measured: it read as "something went wrong" with no
  // request ever sent, which explained nothing)
  const saveDraft = () => {
    const wantTests = testsDirty()
    const canTests = wantTests && testsSaveable()
    const patchName = nameDirty() ? (name.trim() === '' ? fn!.name : name.trim()) : null
    const patchSource = sourceChanged() ? source : null
    if (wantTests && !canTests) toast.info(format(m.testsHeldBack))
    if (patchName === null && patchSource === null && !canTests) return
    let collected: SavePatch['tests'] = null
    if (canTests) {
      const parsed = parsedTests()
      if ('invalidLabel' in parsed) {
        setFailure(format(m.testInputInvalid, { label: parsed.invalidLabel }))
        return
      }
      collected = parsed.tests
    }
    save.mutate({ name: patchName, source: patchSource, tests: collected })
  }
  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // the whole page saves on Cmd/Ctrl+S, wherever focus sits - code, name,
  // a test field; capture-phase so Monaco cannot swallow it first
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault()
        saveDraftRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // closing or reloading the tab with unsaved work asks first; in-app
  // navigation guarding waits for a data router (BrowserRouter has no
  // blocker seam)
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current()) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const publish = useMutation({
    // publishing compiles the draft the SERVER holds, so unsaved edits are
    // saved first - otherwise the button quietly proves yesterday's bytes
    mutationFn: async () => {
      let revision = baseRevision ?? fn!.draftRevision
      if (dirty()) {
        // publication needs the whole draft coherent: tests that changed
        // must be checkable against the CURRENT buffer's contract
        if (testsDirty() && !testsSaveable())
          return Promise.reject(new LocalFinding(format(m.testsHeldBack)))
        const parsed = parsedTests()
        if ('invalidLabel' in parsed)
          return Promise.reject(
            new LocalFinding(format(m.testInputInvalid, { label: parsed.invalidLabel })),
          )
        const savedNow = (await saveEffect({
          name: nameDirty() ? (name.trim() === '' ? fn!.name : name.trim()) : null,
          source: sourceChanged() ? source : null,
          tests: testsDirty() ? parsed.tests : null,
        })) as {
          function: { draftRevision: number }
        }
        revision = savedNow.function.draftRevision
      }
      return run(
        api.assessmentFormula.publishFormulaVersion({
          params: { functionId },
          payload: { expectedDraftRevision: revision },
        }),
      )
    },
    onMutate: () => {
      setFailure(null)
      setFindings({})
    },
    onSuccess: async (result: { version: { versionNo: number } }) => {
      toast.success(format(m.published, { number: result.version.versionNo }))
      await refresh()
    },
    onError: async (error: unknown) => {
      setFailure(error instanceof LocalFinding ? error.message : formatError(error))
      setFindings(findingsOf(error))
      // the auto-save may have landed even though publishing was refused;
      // without a refresh the editor still holds the old revision and the
      // next save would conflict with its own work
      await refresh()
    },
  })

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      run(
        api.assessmentFormula.setFormulaFunctionStatus({
          params: { functionId },
          payload: { status },
        }),
      ),
    onSuccess: () => refresh(),
    onError: (error: unknown) => setFailure(formatError(error)),
  })

  const kindName = (kind: string | undefined): string => {
    switch (kind) {
      case 'text':
        return format(m.kindText)
      case 'integer':
        return format(m.kindInteger)
      case 'decimal':
        return format(m.kindDecimal)
      case 'choice':
        return format(m.kindChoice)
      case 'boolean':
        return format(m.kindBoolean)
      case 'date':
        return format(m.kindDate)
      default:
        return kind ?? ''
    }
  }

  const reasonText = (problem: ReportProblem): string => {
    const constraint = problem.constraint ?? ''
    switch (problem.reason) {
      case 'x-qualy-maximum':
      case 'maximum':
        return format(m.reasonOverMax, { constraint })
      case 'x-qualy-minimum':
      case 'minimum':
        return format(m.reasonUnderMin, { constraint })
      case 'x-qualy-maxScale':
        return format(m.reasonScale, { constraint })
      case 'maxLength':
        return format(m.reasonTooLong, { constraint })
      case 'minLength':
        return format(m.reasonTooShort, { constraint })
      case 'enum':
        return format(m.reasonEnum, { constraint })
      case 'type':
      case 'format':
        return format(m.reasonKind, { kind: kindName(problem.constraint) })
      case 'pattern':
        return format(m.reasonPattern, { constraint })
      case 'required':
        return format(m.reasonMissing)
      case 'additionalProperties':
        return format(m.reasonExtra)
      default:
        return format(m.reasonOther, { reason: problem.reason })
    }
  }

  // the contract table speaks the author's language, not the validator's:
  // every reason a publish can realistically raise here gets its own words,
  // and the most common one - an unbounded output - says exactly what to type
  const contractReasonText = (reason: string): string => {
    switch (reason) {
      case 'not-a-score-amount':
        return format(m.contractNotScoreAmount)
      case 'not-a-decimal':
        return format(m.contractNotDecimal)
      case 'contract-too-large':
        return format(m.contractTooLarge)
      case 'contract-error':
        return format(m.contractError)
      case 'pattern-invalid':
        return format(m.contractPatternInvalid)
      case 'pattern-too-large':
        return format(m.contractPatternTooLarge)
      case 'pattern-too-complex':
        return format(m.contractPatternTooComplex)
      default:
        return format(m.reasonOther, { reason })
    }
  }

  const reportNotes = (row: ReportRow): string => {
    if (row.problems !== undefined && row.problems.length > 0)
      return row.problems
        .map((problem) =>
          problem.at === 'input'
            ? format(m.problemInput, {
                parameter: problem.parameter ?? '',
                detail: reasonText(problem),
              })
            : problem.at === 'output'
              ? format(m.problemOutput, { detail: reasonText(problem) })
              : format(m.problemExpected, { detail: reasonText(problem) }),
        )
        .join('; ')
    if (row.refusal !== undefined) return format(m.refusalPrefix, { message: row.refusal })
    if (row.defect !== undefined) return format(m.defectPrefix, { message: row.defect })
    return row.passed ? '' : format(m.reportMismatch)
  }

  if (detail.isError) {
    return (
      <div {...stylex.props(styles.page)}>
        <Panel title={format(m.listTitle)}>
          <p role="alert">{format(m.loadFailed)}</p>
        </Panel>
      </div>
    )
  }
  if (fn === undefined) return <div {...stylex.props(styles.page)} />

  const archived = fn.status === 'archived'
  const busy = save.isPending || publish.isPending

  return (
    <div {...stylex.props(styles.page)}>
      <PageHeader
        title={fn.name}
        description={
          copiedFrom === null
            ? (fn.description ?? undefined)
            : `${fn.description === null ? '' : `${fn.description} · `}${format(
                m.templatesCopiedFrom,
                { number: copiedFrom.versionNo },
              )}`
        }
        actions={
          <div {...stylex.props(styles.actions)}>
            {archived ? <Badge variant="outline">{format(m.statusArchived)}</Badge> : null}
            <Button
              variant="outline"
              onClick={() => setStatus.mutate(archived ? 'active' : 'archived')}
            >
              {format(archived ? m.restore : m.archive)}
            </Button>
            <Button variant="outline" disabled={archived || busy || !dirty()} onClick={saveDraft}>
              {format(m.save)}
            </Button>
            <Button disabled={archived || busy} onClick={() => publish.mutate()}>
              {format(m.publish)}
            </Button>
          </div>
        }
      />

      {failure === null ? null : <p role="alert">{failure}</p>}

      {remoteMoved ? (
        <Panel title={format(m.remoteMovedTitle)}>
          <p {...stylex.props(styles.hint)}>{format(m.remoteMovedHint)}</p>
          <Button variant="outline" onClick={discardLocal}>
            {format(m.discardLocal)}
          </Button>
        </Panel>
      ) : null}

      <Panel title={format(m.sourceLabel)}>
        <Field label={format(m.nameLabel)}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={archived}
            />
          )}
        </Field>
        <Suspense
          fallback={
            <div {...stylex.props(styles.source)} role="status">
              <Spinner aria-label={format(m.editorLoading)} />
              <span>{format(m.editorLoading)}</span>
            </div>
          }
        >
          <FormulaCodeEditor
            functionId={functionId}
            value={source}
            onChange={setSource}
            seed={editorSeed}
            readOnly={archived}
            ariaLabel={format(m.sourceLabel)}
          />
        </Suspense>
      </Panel>

      <Panel title={format(m.tryTitle)} description={format(m.tryHint)}>
        <p
          {...stylex.props(styles.hint)}
          data-testid="formula-structure"
          data-state={
            preview.current.status === 'ready' && preview.current.source === source
              ? 'synced'
              : preview.current.status === 'refused' && preview.current.source === source
                ? 'refused'
                : contract === null
                  ? 'loading'
                  : 'stale'
          }
        >
          {preview.current.status === 'ready' && preview.current.source === source
            ? format(m.structureSynced)
            : preview.current.status === 'refused' && preview.current.source === source
              ? format(m.structureRefused)
              : contract === null
                ? format(m.structureLoading)
                : format(m.structureStale)}
        </p>
        {contract === null ? null : (
          <>
            <InputValueForm
              schema={contract.inputSchema}
              drafts={tryDrafts}
              onDraft={(name_, draft) => setTryDrafts({ ...tryDrafts, [name_]: draft })}
              locale={locale}
              disabled={archived || running}
              problems={tryIssues}
              scope="try"
            />
            <div {...stylex.props(styles.actions)}>
              <Button disabled={archived || running} onClick={() => void runTry()}>
                {format(running ? m.running : m.run)}
              </Button>
              <Button
                variant="outline"
                disabled={archived || running}
                onClick={() => saveTryAsCase('')}
              >
                {format(m.trySave)}
              </Button>
              {tryResult?.actual === undefined || tryStale(tryResult) ? null : (
                // a STALE actual may never become an expectation: the button
                // exists only while code and inputs both still match the run
                <Button
                  variant="outline"
                  disabled={archived || running}
                  onClick={() => saveTryAsCase(tryResult.actual!)}
                >
                  {format(m.adoptActual, { value: tryResult.actual })}
                </Button>
              )}
            </div>
            {tryResult === null ? null : (
              <p
                data-testid="formula-try-result"
                data-stale={tryStale(tryResult) ? true : undefined}
              >
                {tryStale(tryResult)
                  ? format(m.resultStale)
                  : tryResult.actual !== undefined
                    ? format(m.resultActual, { value: tryResult.actual })
                    : tryResult.refusal !== undefined
                      ? format(m.refusalPrefix, { message: tryResult.refusal })
                      : tryResult.defect !== undefined
                        ? format(m.defectPrefix, { message: tryResult.defect })
                        : format(m.testInputInvalid, { label: format(m.tryTitle) })}
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title={format(m.testsTitle)} description={format(m.testsHint)}>
        <div {...stylex.props(styles.testGrid)}>
          {tests.map((test) => {
            const outcome = runResults[test.key]
            const stale =
              outcome !== undefined &&
              (outcome.forSource !== source || outcome.forCase !== caseFingerprint(test))
            const expectedProblem = expectedIssueOf(test, contract)
            const legal = rowLegal(test)
            return (
              <div
                key={test.key}
                {...stylex.props(styles.testCase)}
                data-testid="formula-test-case"
                data-legal={legal}
              >
                <div {...stylex.props(styles.testRow)}>
                  <Input
                    aria-label={format(m.testName)}
                    placeholder={format(m.testName)}
                    value={test.name}
                    disabled={archived}
                    onChange={(event) =>
                      setTests(
                        tests.map((one) =>
                          one.key === test.key ? { ...one, name: event.target.value } : one,
                        ),
                      )
                    }
                  />
                  <div {...stylex.props(styles.actions)}>
                    <Button
                      variant="outline"
                      disabled={archived || running}
                      onClick={() => void runRows([test.key])}
                    >
                      {format(m.run)}
                    </Button>
                    <Button variant="ghost" disabled={archived} onClick={() => loadIntoTry(test)}>
                      {format(m.loadIntoTry)}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={archived}
                      onClick={() => setTests([...tests, { ...test, key: newTestKey() }])}
                    >
                      {format(m.copyTest)}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={archived}
                      onClick={() => setTests(tests.filter((one) => one.key !== test.key))}
                    >
                      {format(m.removeTest)}
                    </Button>
                  </div>
                </div>
                {contract === null ? (
                  <Input
                    aria-label={format(m.testInput)}
                    placeholder={'{"value": "2.34"}'}
                    value={test.inputText}
                    disabled={archived}
                    onChange={(event) =>
                      setTests(
                        tests.map((one) =>
                          one.key === test.key ? { ...one, inputText: event.target.value } : one,
                        ),
                      )
                    }
                  />
                ) : (
                  <InputValueForm
                    schema={contract.inputSchema}
                    drafts={draftsOfRow(test)}
                    onDraft={(name_, draft) => editRow(test, name_, draft)}
                    locale={locale}
                    disabled={archived}
                    problems={rowIssues[test.key]}
                    scope={`case-${test.key}`}
                  />
                )}
                {contract === null ? (
                  <Input
                    aria-label={format(m.testExpected)}
                    placeholder={format(m.expectedLabel)}
                    value={test.expected}
                    disabled={archived}
                    onChange={(event) =>
                      setTests(
                        tests.map((one) =>
                          one.key === test.key ? { ...one, expected: event.target.value } : one,
                        ),
                      )
                    }
                  />
                ) : (
                  // the expectation faces the OUTPUT contract like inputs
                  // face the input contract; '' stays legal until publish
                  <AtomicValueField
                    schema={contract.outputSchema}
                    name={`expected-${test.key}`}
                    label={format(m.expectedLabel)}
                    draft={test.expected}
                    onDraft={(draft) =>
                      setTests(
                        tests.map((one) =>
                          one.key === test.key
                            ? {
                                ...one,
                                expected: typeof draft === 'string' ? draft : String(draft),
                              }
                            : one,
                        ),
                      )
                    }
                    locale={locale}
                    disabled={archived}
                    {...(expectedProblem === null ? {} : { problem: expectedProblem })}
                  />
                )}
                {legal ? null : (
                  <p {...stylex.props(styles.problemLine)} role="alert">
                    {format(m.testRowInvalid)}
                  </p>
                )}
                {outcome === undefined ? null : (
                  <p
                    data-testid="formula-case-result"
                    data-passed={stale ? undefined : outcome.passed}
                    data-stale={stale ? true : undefined}
                  >
                    {stale
                      ? format(m.resultStale)
                      : outcome.passed === true
                        ? format(m.resultPassed)
                        : outcome.refusal !== undefined
                          ? format(m.refusalPrefix, { message: outcome.refusal })
                          : outcome.defect !== undefined
                            ? format(m.defectPrefix, { message: outcome.defect })
                            : format(m.resultFailed, { actual: outcome.actual ?? '—' })}
                  </p>
                )}
              </div>
            )
          })}
        </div>
        <div {...stylex.props(styles.actions)}>
          <Button
            variant="outline"
            disabled={archived}
            onClick={() =>
              setTests([...tests, { key: newTestKey(), name: '', inputText: '{}', expected: '' }])
            }
          >
            {format(m.addTest)}
          </Button>
          <Button
            variant="outline"
            disabled={archived || running || tests.length === 0}
            onClick={() => void runRows(tests.map((one) => one.key))}
          >
            {format(running ? m.running : m.runAll)}
          </Button>
        </div>
      </Panel>

      {findings.diagnostics === undefined || findings.diagnostics.length === 0 ? null : (
        <Panel title={format(m.diagnosticsTitle)}>
          <table {...stylex.props(styles.reportTable)} data-testid="formula-diagnostics">
            <tbody>
              {findings.diagnostics.map((row, index) => (
                <tr key={index}>
                  <td {...stylex.props(styles.reportCell, styles.mono)}>
                    {row.line}:{row.column}
                  </td>
                  <td {...stylex.props(styles.reportCell, styles.mono)}>{row.code}</td>
                  <td {...stylex.props(styles.reportCell)}>{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {findings.issues === undefined || findings.issues.length === 0 ? null : (
        <Panel title={format(m.contractIssuesTitle)}>
          <table {...stylex.props(styles.reportTable)} data-testid="formula-contract-issues">
            <tbody>
              {findings.issues.map((row, index) => (
                <tr key={index} data-reason={row.reason}>
                  <td {...stylex.props(styles.reportCell, styles.mono)}>{row.path}</td>
                  <td {...stylex.props(styles.reportCell)}>{contractReasonText(row.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {findings.detail === undefined ? null : (
            <p {...stylex.props(styles.hint, styles.mono)}>{findings.detail}</p>
          )}
        </Panel>
      )}

      {findings.report === undefined || findings.report.length === 0 ? null : (
        <Panel title={format(m.reportTitle)}>
          <table {...stylex.props(styles.reportTable)} data-testid="formula-test-report">
            <thead>
              <tr>
                <th {...stylex.props(styles.reportCell)}>{format(m.testName)}</th>
                <th {...stylex.props(styles.reportCell)}>{format(m.reportOutcome)}</th>
                <th {...stylex.props(styles.reportCell)}>{format(m.testExpected)}</th>
                <th {...stylex.props(styles.reportCell)}>{format(m.reportActualColumn)}</th>
                <th {...stylex.props(styles.reportCell)}>{format(m.reportDetail)}</th>
              </tr>
            </thead>
            <tbody>
              {findings.report.map((row, index) => (
                <tr key={index} data-passed={row.passed}>
                  <td {...stylex.props(styles.reportCell)}>{row.name}</td>
                  <td {...stylex.props(styles.reportCell)}>
                    {format(row.passed ? m.reportPassed : m.reportFailed)}
                  </td>
                  <td {...stylex.props(styles.reportCell, styles.mono)}>{row.expected}</td>
                  <td {...stylex.props(styles.reportCell, styles.mono)}>{row.actual ?? '—'}</td>
                  <td {...stylex.props(styles.reportCell)}>{reportNotes(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title={format(m.versionsTitle)}>
        {versions.length === 0 ? (
          <p {...stylex.props(styles.hint)}>{format(m.versionsEmpty)}</p>
        ) : (
          <table {...stylex.props(styles.reportTable)} data-testid="formula-versions">
            <tbody>
              {versions.map((version) => (
                <tr key={version.versionNo} data-version={version.versionNo}>
                  <td {...stylex.props(styles.reportCell)}>
                    {format(m.versionNumber, { number: version.versionNo })}
                  </td>
                  <td {...stylex.props(styles.reportCell, styles.mono)}>
                    {version.contractSha256.slice(0, 12)}
                  </td>
                  <td {...stylex.props(styles.reportCell)}>
                    {new Date(version.publishedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}
