import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { repoRoot } from '../lib/manifest.ts'
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  CONTROL_ITEMS,
  cellName,
  ensureDataset,
  expectedTotal,
  type Dataset,
  type DatasetAudit,
  type DatasetBatch,
  type SessionCookie,
} from './support/dataset.ts'
import {
  benchmarkUrl,
  ensureDatabase,
  openDb,
  pgStatDelta,
  pgStatSnapshot,
  type PgStats,
} from './support/pg.ts'
import {
  assertStagedAssets,
  benchDir,
  benchStateDir,
  cli,
  counterOf,
  histogramOf,
  percentiles,
  requireSandbox,
  sampleProcess,
  sandboxCpuSeconds,
  startOtlpReceiver,
  startServer,
  writeBenchManifest,
  type Percentiles,
  type RunningServer,
  type Snapshot,
} from './support/server.ts'

// Formula provisional scoring, measured from where a student stands.
//
// The real production entry over a benchmark assembly of its own, a dataset
// of published formulas and determinations in force, and one student after
// another opening the results page: p50/p95 as the browser would see them,
// and what the server, the database and the sandbox did to answer. Run by
// hand, never in CI; `pnpm sandbox:up` and `pnpm build` first.
//
//   pnpm benchmark:formula-scoring [--cells 1,5,10,50] [--rounds 2] [--concurrency 1]
//                                  [--warmup 1] [--control] [--reseed] [--soak N]
//                                  [--port 3198] [--otlp-port 43180] [--out <file>]

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
const numberOption = (name: string, fallback: number) => Number(option(name) ?? fallback)

const cells = (option('cells') ?? '1,5,10,50').split(',').map(Number)
const rounds = numberOption('rounds', 2)
const concurrency = numberOption('concurrency', 1)
const warmup = numberOption('warmup', 1)
const soak = numberOption('soak', 0)
const port = numberOption('port', 3198)
const otlpPort = numberOption('otlp-port', 43180)
const control = flag('control')
const reseed = flag('reseed')
// with telemetry off the server exports nothing: invocations are then the
// dataset's arithmetic rather than a counter, and the run says so
const telemetry = !flag('no-telemetry')
// e.g. --node-args "--max-old-space-size=1024 --trace-gc": the server's node, not this one
const nodeArgs = (option('node-args') ?? '').split(/\s+/).filter((arg) => arg !== '')
const out =
  option('out') ?? path.join(benchDir, `${new Date().toISOString().replaceAll(':', '-')}.json`)

const log = (line: string) => console.log(`benchmark: ${line}`)
const RESULT_ROUTE = '/api/assessment/batches/:batchId/me/result'
const EVALUATION = 'qualy.assessment.scoring.evaluation'
const OUTCOMES = [
  'success',
  'refusal',
  'unavailable',
  'execution',
  'integrity',
  'invariant',
] as const

interface RoundResult {
  readonly round: number
  readonly requests: number
  readonly concurrency: number
  readonly ok: number
  readonly http5xx: number
  readonly mismatched: number
  /** requests the server never answered: it was gone */
  readonly unanswered: number
  readonly latencyMs: Percentiles
  readonly server: {
    readonly http: { count: number; sumSeconds: number }
    readonly dbOperations: number
    readonly evaluation: Record<(typeof OUTCOMES)[number], number>
  }
  readonly pg: PgStats
  readonly process: { rssMaxBytes: number; cpuSeconds: number }
  readonly sandbox: { cpuSeconds: number | null }
  /** deadlines crossed during the round, by phase, from the server's own log */
  readonly timeouts: { soft: number; hard: number }
  readonly wallMs: number
  readonly requestsPerSecond: number
  readonly expected: { invokes: number; total: string }
  readonly holds: boolean
}

const timeoutsIn = (
  lines: readonly { message: string; annotations: Readonly<Record<string, unknown>> }[],
) =>
  lines.reduce(
    (total, line) => {
      if (line.message !== 'scoring failed') return total
      const reason = String(line.annotations['reason'] ?? '')
      return {
        soft: total.soft + (reason.includes('soft deadline') ? 1 : 0),
        hard: total.hard + (reason.includes('hard deadline') ? 1 : 0),
      }
    },
    { soft: 0, hard: 0 },
  )

interface CellResult {
  readonly name: string
  readonly kind: DatasetBatch['kind']
  readonly items: number
  readonly entries: number
  readonly batchId: string
  readonly rounds: readonly RoundResult[]
}

interface SoakRun {
  readonly run: number
  readonly exitCode: number | null
  readonly listeningMs: number | null
  readonly shutdownMs: number
  readonly finalizers: readonly { name: string; ms: number }[]
  readonly stillReleasing: string | null
  readonly requests: number
  readonly p95ms: number
}

const runOrThrow = (what: string, file: string, argv: string[], env: NodeJS.ProcessEnv) => {
  const ran = spawnSync(process.execPath, [file, ...argv], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    timeout: 300_000,
  })
  if (ran.status !== 0)
    throw new Error(`${what} failed (exit ${ran.status}):\n${ran.stdout}${ran.stderr}`)
  return ran.stdout
}

/** runs `tasks` with at most `limit` in flight, in order of submission */
const pooled = async (tasks: readonly (() => Promise<void>)[], limit: number) => {
  let next = 0
  const worker = async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= tasks.length) return
      await tasks[index]!()
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker))
}

const resultPage = async (base: string, batchId: string, session: SessionCookie) => {
  const started = performance.now()
  try {
    const response = await fetch(`${base}/api/assessment/batches/${batchId}/me/result`, {
      headers: { cookie: `${session.name}=${session.token}` },
    })
    const text = await response.text()
    return { ms: performance.now() - started, status: response.status, text }
  } catch (error) {
    // the server went away under the request: a status of its own, so the
    // round records it and the run goes on to say what the server said last
    return { ms: performance.now() - started, status: 0, text: String(error) }
  }
}

/** what the server said, kept beside the summary: the evidence a crash leaves */
const writeServerLog = (file: string, lines: readonly { raw: string }[]) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${lines.map((line) => line.raw).join('\n')}\n`)
}

const evaluationCounts = (snapshot: Snapshot | undefined) =>
  Object.fromEntries(
    OUTCOMES.map((outcome) => [
      outcome,
      counterOf(snapshot, EVALUATION, { operation: 'result', outcome }),
    ]),
  ) as Record<(typeof OUTCOMES)[number], number>

const main = async () => {
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
  const sandbox = requireSandbox()
  const { manifest, resolutionHash } = writeBenchManifest()
  assertStagedAssets(resolutionHash)
  log(`assembly ${resolutionHash} over ${path.relative(repoRoot, manifest)}`)

  const databaseUrl = benchmarkUrl()
  const database = await ensureDatabase(databaseUrl, reseed)
  log(`database ${database}`)
  const { QUALY_MIGRATIONS: _migrations, ...inherited } = process.env
  runOrThrow('deploy', cli, ['deploy', '--yml', manifest], {
    ...inherited,
    DATABASE_URL: databaseUrl,
    // the benchmark instance's own state, which the server below is checked against
    QUALY_STATE_DIR: benchStateDir,
  })
  runOrThrow('seed', path.join(repoRoot, 'tools/fixtures/seed-cli.ts'), [], {
    ...inherited,
    DATABASE_URL: databaseUrl,
    QUALY_ADMIN_USERNAME: ADMIN_USERNAME,
    QUALY_ADMIN_PASSWORD: ADMIN_PASSWORD,
  })

  // the receiver before the server: an exporter whose first post fails goes
  // quiet for a minute, which is longer than a round
  const receiver = await startOtlpReceiver(otlpPort)
  const db = await openDb(databaseUrl)
  const serve = (level: 'info' | 'debug') =>
    startServer({
      port,
      manifest,
      databaseUrl,
      otlpEndpoint: telemetry ? receiver.endpoint : null,
      level,
      nodeArgs,
    })

  let server: RunningServer | undefined
  let exitCode = 0
  const cellResults: CellResult[] = []
  const soakRuns: SoakRun[] = []
  let boot: { listeningMs: number | null; shutdownMs: number; exitCode: number | null } | undefined
  let dataset: Dataset | undefined
  // the cookie name the entry reads, learned from the dataset's sign-in
  let cookieName = ''
  let datasetAudit: DatasetAudit | undefined
  try {
    server = serve('info')
    const ready = await server.ready()
    log(`server pid ${server.pid} listening after ${ready.listeningMs ?? '?'}ms`)
    const ensured = await ensureDataset({
      db,
      base: server.base,
      databaseUrl,
      resolutionHash,
      cells,
      control,
      mode: database === 'created' || reseed ? 'seed' : 'verify',
      log,
    })
    dataset = ensured.dataset
    datasetAudit = ensured.audit
    cookieName = ensured.cookieName
    if (datasetAudit.verdict !== 'clean') {
      // the runtime under four-way load, before a single page was asked for:
      // reported with the rest, never hidden behind a retry
      log(
        `audit over the dataset: ${datasetAudit.verdict} (execution failed ${datasetAudit.counts['execution failed'] ?? 0}, unavailable ${datasetAudit.counts['unavailable'] ?? 0})`,
      )
    }

    const plan: { name: string; batch: DatasetBatch }[] = cells.map((items) => ({
      name: cellName(items, 'formula'),
      batch: dataset!.batches[cellName(items, 'formula')]!,
    }))
    if (control) {
      const name = cellName(CONTROL_ITEMS, 'control')
      plan.push({ name, batch: dataset.batches[name]! })
    }

    for (const { name, batch } of plan) {
      const roundResults: RoundResult[] = []
      const expectedTotalString = expectedTotal(batch.items)
      const students = dataset.sessions
      for (let index = 0; index < warmup; index += 1) {
        await resultPage(server.base, batch.id, {
          name: cookieName,
          token: students[index % students.length]!,
        })
      }
      for (let round = 1; round <= rounds; round += 1) {
        // two full exports after the warm-up: the export in flight when the
        // warm-up answered may still carry its counters, and the one after
        // it is the first that cannot
        if (telemetry) await receiver.awaitExports(2)
        const before = {
          otlp: receiver.latest(),
          pg: await pgStatSnapshot(db),
          sandbox: sandboxCpuSeconds(sandbox.containerId),
          process: sampleProcess(server.pid),
        }
        let rssMax = before.process?.rssBytes ?? 0
        const firstLine = server.lines.length
        const startedAt = performance.now()
        const sampler = setInterval(() => {
          const sample = sampleProcess(server!.pid)
          if (sample && sample.rssBytes > rssMax) rssMax = sample.rssBytes
        }, 1_000)
        const latencies: number[] = []
        let ok = 0
        let http5xx = 0
        let mismatched = 0
        let unanswered = 0
        await pooled(
          students.map((token) => async () => {
            if (server!.exited() !== null) {
              unanswered += 1
              return
            }
            const answer = await resultPage(server!.base, batch.id, { name: cookieName, token })
            latencies.push(answer.ms)
            if (answer.status === 0) {
              unanswered += 1
              return
            }
            if (answer.status >= 500) {
              http5xx += 1
              return
            }
            if (answer.status !== 200) {
              mismatched += 1
              return
            }
            const body = JSON.parse(answer.text) as { total: string; lines: unknown[] }
            if (body.total === expectedTotalString && body.lines.length === batch.items) ok += 1
            else mismatched += 1
          }),
          concurrency,
        )
        clearInterval(sampler)
        const wallMs = performance.now() - startedAt
        // two more exports after the last answer, so every counter has landed
        if (telemetry) await receiver.awaitExports(2)
        else await delay(2_500)
        const timeouts = timeoutsIn(server.lines.slice(firstLine))
        const after = {
          otlp: receiver.latest(),
          pg: await pgStatSnapshot(db),
          sandbox: sandboxCpuSeconds(sandbox.containerId),
          process: sampleProcess(server.pid),
        }
        const evaluationBefore = evaluationCounts(before.otlp)
        const evaluationAfter = evaluationCounts(after.otlp)
        const evaluation = Object.fromEntries(
          OUTCOMES.map((outcome) => [
            outcome,
            evaluationAfter[outcome] - evaluationBefore[outcome],
          ]),
        ) as RoundResult['server']['evaluation']
        const httpBefore = histogramOf(before.otlp, 'http.server.request.duration', {
          'http.route': RESULT_ROUTE,
        })
        const httpAfter = histogramOf(after.otlp, 'http.server.request.duration', {
          'http.route': RESULT_ROUTE,
        })
        const invokes = OUTCOMES.reduce((total, outcome) => total + evaluation[outcome], 0)
        const expectedInvokes = students.length * batch.items
        const result: RoundResult = {
          round,
          requests: students.length,
          concurrency,
          ok,
          http5xx,
          mismatched,
          unanswered,
          latencyMs: percentiles(latencies),
          server: {
            http: {
              count: httpAfter.count - httpBefore.count,
              sumSeconds: httpAfter.sum - httpBefore.sum,
            },
            dbOperations:
              histogramOf(after.otlp, 'db.client.operation.duration').count -
              histogramOf(before.otlp, 'db.client.operation.duration').count,
            evaluation,
          },
          pg: pgStatDelta(before.pg, after.pg),
          process: {
            rssMaxBytes: rssMax,
            cpuSeconds: (after.process?.cpuSeconds ?? 0) - (before.process?.cpuSeconds ?? 0),
          },
          sandbox: {
            cpuSeconds:
              before.sandbox === null || after.sandbox === null
                ? null
                : after.sandbox - before.sandbox,
          },
          timeouts,
          wallMs,
          requestsPerSecond: (students.length / wallMs) * 1000,
          expected: { invokes: expectedInvokes, total: expectedTotalString },
          holds:
            http5xx === 0 &&
            mismatched === 0 &&
            unanswered === 0 &&
            timeouts.soft + timeouts.hard === 0 &&
            (!telemetry ||
              (evaluation.execution === 0 &&
                evaluation.unavailable === 0 &&
                invokes === expectedInvokes)),
        }
        if (!result.holds) exitCode = 1
        roundResults.push(result)
        if (server.exited() !== null) {
          const last = server.lines.slice(-8).map((line) => `    ${line.raw.slice(0, 300)}`)
          log(
            `the server exited ${server.exited()} during ${name} round ${round}; its last lines:\n${last.join('\n')}`,
          )
          exitCode = 1
          break
        }
        log(
          `${name} round ${round}: p50 ${result.latencyMs.p50.toFixed(1)}ms p95 ${result.latencyMs.p95.toFixed(1)}ms ${result.requestsPerSecond.toFixed(1)} req/s invokes ${invokes}/${expectedInvokes} timeouts soft ${timeouts.soft} hard ${timeouts.hard}${result.holds ? '' : ' (INVARIANT BROKEN)'}`,
        )
      }
      cellResults.push({
        name,
        kind: batch.kind,
        items: batch.items,
        entries: batch.items * dataset.students,
        batchId: batch.id,
        rounds: roundResults,
      })
      if (server.exited() !== null) break
    }

    writeServerLog(`${out.replace(/\.json$/, '')}.server.log`, server.lines)
    const stopped = await server.stop()
    boot = {
      listeningMs: ready.listeningMs,
      shutdownMs: stopped.shutdownMs,
      exitCode: stopped.exitCode,
    }
    if (stopped.exitCode !== 0) {
      exitCode = 1
      log(
        `shutdown exited ${stopped.exitCode ?? 'never (killed)'}${stopped.stillReleasing ? `: ${stopped.stillReleasing}` : ''}`,
      )
    }
    server = undefined

    for (let run = 1; run <= soak; run += 1) {
      const instance = serve('debug')
      server = instance
      const readyAt = await instance.ready()
      const first = plan[0]!
      const latencies: number[] = []
      for (const token of dataset.sessions) {
        latencies.push(
          (await resultPage(instance.base, first.batch.id, { name: cookieName, token })).ms,
        )
      }
      const stopped = await instance.stop()
      server = undefined
      const record: SoakRun = {
        run,
        exitCode: stopped.exitCode,
        listeningMs: readyAt.listeningMs,
        shutdownMs: stopped.shutdownMs,
        finalizers: stopped.finalizers,
        stillReleasing: stopped.stillReleasing,
        requests: latencies.length,
        p95ms: percentiles(latencies).p95,
      }
      soakRuns.push(record)
      log(
        `soak ${run}/${soak}: listening ${record.listeningMs ?? '?'}ms, shutdown ${record.shutdownMs}ms, exit ${record.exitCode ?? 'never (killed)'}`,
      )
      if (stopped.exitCode !== 0) {
        exitCode = 1
        log(
          `soak ${run} did not exit cleanly${stopped.stillReleasing ? `: ${stopped.stillReleasing}` : ''}`,
        )
        break
      }
    }
  } finally {
    server?.kill()
    await receiver.close()
    await db.end()
  }

  const summary = {
    version: 1,
    startedAt: new Date().toISOString(),
    commit,
    node: process.version,
    args: { cells, rounds, concurrency, warmup, control, soak, port, telemetry, nodeArgs },
    assembly: { manifest: path.relative(repoRoot, manifest), resolutionHash },
    server: { port, ...boot },
    sandbox,
    dataset:
      dataset === undefined ? null : { tenantId: dataset.tenantId, students: dataset.students },
    datasetAudit:
      datasetAudit === undefined
        ? null
        : {
            verdict: datasetAudit.verdict,
            timeouts: datasetAudit.timeouts,
            exitCode: datasetAudit.exitCode,
            counts: datasetAudit.counts,
          },
    cells: cellResults,
    soak: soakRuns,
    holds: exitCode === 0,
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`)

  const header = [
    'cell',
    'items',
    'entries',
    'round',
    'conc',
    'reqs',
    'p50ms',
    'p95ms',
    'maxms',
    'req/s',
    '5xx',
    'invokes',
    'exec',
    'soft',
    'hard',
    'unavail',
    'sql/req',
    'fv.idx_scan',
    'srv.rss.max',
    'srv.cpu.s',
    'sbx.cpu.s',
    'holds',
  ]
  const rows = cellResults.flatMap((cell) =>
    cell.rounds.map((round) => [
      cell.kind === 'control' ? `control(fixed@1×${cell.items})` : String(cell.items),
      String(cell.items),
      String(cell.entries),
      String(round.round),
      String(round.concurrency),
      String(round.requests),
      round.latencyMs.p50.toFixed(1),
      round.latencyMs.p95.toFixed(1),
      round.latencyMs.max.toFixed(1),
      round.requestsPerSecond.toFixed(1),
      String(round.http5xx),
      telemetry
        ? `${OUTCOMES.reduce((total, outcome) => total + round.server.evaluation[outcome], 0)}/${round.expected.invokes}`
        : `n/a/${round.expected.invokes}`,
      telemetry ? String(round.server.evaluation.execution) : 'n/a',
      String(round.timeouts.soft),
      String(round.timeouts.hard),
      telemetry ? String(round.server.evaluation.unavailable) : 'n/a',
      telemetry ? (round.server.dbOperations / round.requests).toFixed(1) : 'n/a',
      String(round.pg.formulaVersionsIdxScan),
      `${(round.process.rssMaxBytes / 1_048_576).toFixed(0)}MiB`,
      round.process.cpuSeconds.toFixed(1),
      round.sandbox.cpuSeconds === null ? '?' : round.sandbox.cpuSeconds.toFixed(2),
      round.holds ? 'yes' : 'NO',
    ]),
  )
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]!.length)),
  )
  const line = (row: readonly string[]) =>
    row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ')
  console.log('')
  console.log(
    `formula provisional scoring — ${commit} ${summary.startedAt}   server port ${port}   sandbox ${sandbox.containerId.slice(0, 12)}`,
  )
  console.log(line(header))
  for (const row of rows) console.log(line(row))
  if (datasetAudit) {
    console.log(
      `audit (qualy assessment audit-scoring, 4 in flight): ${datasetAudit.verdict}; timeouts soft ${datasetAudit.timeouts.soft} hard ${datasetAudit.timeouts.hard}; ${Object.entries(
        datasetAudit.counts,
      )
        .map(([key, value]) => `${key} ${value}`)
        .join(', ')}`,
    )
  }
  if (boot)
    console.log(
      `boot: http listening ${boot.listeningMs ?? '?'}ms   shutdown ${boot.shutdownMs}ms   exit ${boot.exitCode ?? 'never'}`,
    )
  if (soakRuns.length > 0) {
    const shutdowns = percentiles(soakRuns.map((run) => run.shutdownMs))
    const slowest = soakRuns.flatMap((run) => run.finalizers).sort((a, b) => b.ms - a.ms)[0]
    console.log(
      `soak: ${soakRuns.length} run(s), exit codes [${soakRuns.map((run) => run.exitCode ?? 'never').join(', ')}], shutdown p50 ${shutdowns.p50}ms max ${shutdowns.max}ms${slowest ? `, slowest finalizer ${slowest.name} ${slowest.ms}ms` : ''}`,
    )
  }
  console.log(`written ${path.relative(repoRoot, out)}`)
  process.exitCode = exitCode
}

await main()
