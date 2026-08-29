import * as stylex from '@stylexjs/stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useApi, useApiQuery, usePageRouteParams, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Badge } from '@qualy/ui/badge'
import { toast } from '@qualy/ui/toast'
import { Field, PageHeader, Panel } from '@qualy/ui/admin'
import { formulaApi } from './api.ts'
import { formulaMessages as m } from './i18n.ts'

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem' },
  source: {
    width: '100%',
    minHeight: '22rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.8125rem',
    lineHeight: 1.55,
    padding: '0.75rem',
    borderRadius: '0.5rem',
    border: '1px solid var(--q-border)',
    background: 'var(--q-surface)',
    color: 'var(--q-foreground)',
    resize: 'vertical',
  },
  actions: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' },
  testGrid: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' },
  testRow: { display: 'grid', gridTemplateColumns: '1fr 2fr 1fr auto', gap: '0.5rem' },
  reportTable: { width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' },
  reportCell: { padding: '0.375rem 0.5rem', borderTop: '1px solid var(--q-border)' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  hint: { fontSize: '0.8125rem', color: 'var(--q-surface-muted-foreground)' },
})

interface DraftTest {
  name: string
  inputText: string
  expected: string
}

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
      at: 'input' | 'expected'
      parameter?: string
      reason: string
      constraint?: string
    }[]
    refusal?: string
    defect?: string
  }[]
  readonly issues?: readonly { path: string; reason: string }[]
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
  }
}

export default function FormulaEditorPage() {
  const { functionId } = usePageRouteParams('functionId')
  const api = useApi(formulaApi)
  const run = useRunApi()
  const query = useApiQuery(formulaApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()

  const detail = useQuery(
    query.assessmentFormula.getFormulaFunction.queryOptions({ params: { functionId } }),
  )
  const fn = detail.data?.function
  const versions = detail.data?.versions ?? []

  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [tests, setTests] = useState<DraftTest[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [findings, setFindings] = useState<PublishFindings>({})

  // the draft the editor holds follows whatever revision the server answers
  // with; a save or a publish refreshing the query re-seeds it
  useEffect(() => {
    if (fn === undefined) return
    setName(fn.name)
    setSource(fn.draftSourceTs)
    setTests(
      fn.draftTests.map((test) => ({
        name: test.name,
        inputText: JSON.stringify(test.input),
        expected: test.expected,
      })),
    )
  }, [fn?.id, fn?.draftRevision])

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

  // whether the editor holds anything the server has not seen yet
  const dirty = (): boolean =>
    fn === undefined
      ? false
      : name.trim() !== fn.name ||
        source !== fn.draftSourceTs ||
        JSON.stringify(tests) !==
          JSON.stringify(
            fn.draftTests.map((test) => ({
              name: test.name,
              inputText: JSON.stringify(test.input),
              expected: test.expected,
            })),
          )

  const saveEffect = (collected: { name: string; input: unknown; expected: string }[]) =>
    run(
      api.assessmentFormula.updateFormulaDraft({
        params: { functionId },
        payload: {
          expectedDraftRevision: fn!.draftRevision,
          name: name.trim() === '' ? fn!.name : name.trim(),
          draftSourceTs: source,
          draftTests: collected,
        },
      }),
    )

  const save = useMutation({
    mutationFn: saveEffect,
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
    const parsed = parsedTests()
    if ('invalidLabel' in parsed) {
      setFailure(format(m.testInputInvalid, { label: parsed.invalidLabel }))
      return
    }
    save.mutate(parsed.tests)
  }

  const publish = useMutation({
    // publishing compiles the draft the SERVER holds, so unsaved edits are
    // saved first - otherwise the button quietly proves yesterday's bytes
    mutationFn: async () => {
      let revision = fn!.draftRevision
      if (dirty()) {
        const parsed = parsedTests()
        if ('invalidLabel' in parsed)
          return Promise.reject(
            new LocalFinding(format(m.testInputInvalid, { label: parsed.invalidLabel })),
          )
        const savedNow = (await saveEffect(parsed.tests)) as {
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
      case 'pattern':
        return format(m.reasonKind, { kind: kindName(problem.constraint) })
      case 'required':
        return format(m.reasonMissing)
      case 'additionalProperties':
        return format(m.reasonExtra)
      default:
        return format(m.reasonOther, { reason: problem.reason })
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
        description={fn.description ?? undefined}
        actions={
          <div {...stylex.props(styles.actions)}>
            {archived ? <Badge variant="outline">{format(m.statusArchived)}</Badge> : null}
            <Button
              variant="outline"
              onClick={() => setStatus.mutate(archived ? 'active' : 'archived')}
            >
              {format(archived ? m.restore : m.archive)}
            </Button>
            <Button variant="outline" disabled={archived || busy} onClick={saveDraft}>
              {format(m.save)}
            </Button>
            <Button disabled={archived || busy} onClick={() => publish.mutate()}>
              {format(m.publish)}
            </Button>
          </div>
        }
      />

      {failure === null ? null : <p role="alert">{failure}</p>}

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
        <textarea
          {...stylex.props(styles.source)}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          disabled={archived}
          spellCheck={false}
          aria-label={format(m.sourceLabel)}
        />
      </Panel>

      <Panel title={format(m.testsTitle)} description={format(m.testsHint)}>
        <div {...stylex.props(styles.testGrid)}>
          {tests.map((test, index) => (
            <div key={index} {...stylex.props(styles.testRow)}>
              <Input
                aria-label={format(m.testName)}
                placeholder={format(m.testName)}
                value={test.name}
                disabled={archived}
                onChange={(event) =>
                  setTests(
                    tests.map((one, at) =>
                      at === index ? { ...one, name: event.target.value } : one,
                    ),
                  )
                }
              />
              <Input
                aria-label={format(m.testInput)}
                placeholder={'{"value": "2.34"}'}
                value={test.inputText}
                disabled={archived}
                onChange={(event) =>
                  setTests(
                    tests.map((one, at) =>
                      at === index ? { ...one, inputText: event.target.value } : one,
                    ),
                  )
                }
              />
              <Input
                aria-label={format(m.testExpected)}
                placeholder={format(m.testExpected)}
                value={test.expected}
                disabled={archived}
                onChange={(event) =>
                  setTests(
                    tests.map((one, at) =>
                      at === index ? { ...one, expected: event.target.value } : one,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                disabled={archived}
                onClick={() => setTests(tests.filter((_, at) => at !== index))}
              >
                {format(m.removeTest)}
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          disabled={archived}
          onClick={() => setTests([...tests, { name: '', inputText: '{}', expected: '' }])}
        >
          {format(m.addTest)}
        </Button>
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
                <tr key={index}>
                  <td {...stylex.props(styles.reportCell, styles.mono)}>{row.path}</td>
                  <td {...stylex.props(styles.reportCell)}>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
