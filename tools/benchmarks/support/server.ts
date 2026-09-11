import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { lockPathFor, readLock, readManifest, renderManifest, writeAtomic } from '@qualy/assembly'
import { repoRoot } from '../../lib/manifest.ts'

// The system under test, from the outside: a benchmark assembly of its own,
// the real production entry spawned over it, the readiness and shutdown the
// deployment relies on, and the three places its numbers can be read from -
// the process table, the sandbox container's cgroup, and the metrics the
// server itself exports.

export const benchDir = path.join(repoRoot, '.qualy', 'benchmarks')
export const cli = path.join(repoRoot, 'apps/cli/src/main.ts')

const RUNTIME_SOCKET = '.qualy/run/sandbox/runtime/runtime.sock'
const AUTHORING_SOCKET = '.qualy/run/sandbox/authoring/authoring.sock'

/**
 * The assembly the benchmark runs: the repository's, with the formula
 * writer open. Configuration is outside the resolution hash, so the staged
 * browser assets built for the repository's manifest serve this one too.
 */
export const writeBenchManifest = (): { manifest: string; resolutionHash: string } => {
  const source = readManifest(path.join(repoRoot, 'qualy.yml'))
  const plugins = new Map(source.plugins)
  const configure = (id: string, config: Record<string, unknown>) => {
    const entry = plugins.get(id)
    if (entry === undefined) throw new Error(`${id} is not in qualy.yml; the benchmark needs it`)
    const current = (entry.config ?? {}) as Record<string, unknown>
    plugins.set(id, { ...entry, config: { ...current, ...config } })
  }
  // both paths are relative to the manifest, which now lives two levels down
  configure('@qualy/plugin-database', { migrationsFolder: '../../db/migrations' })
  configure('@qualy/plugin-assessment-formula', { authoring: true })
  fs.mkdirSync(benchDir, { recursive: true })
  const manifest = path.join(benchDir, 'qualy.yml')
  writeAtomic(manifest, renderManifest({ ...source, workspace: '../../apps/server', plugins }))
  const resolved = spawnSync(process.execPath, [cli, 'resolve', '--yml', manifest], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (resolved.status !== 0) {
    throw new Error(
      `resolving the benchmark manifest failed:\n${resolved.stderr}${resolved.stdout}`,
    )
  }
  const lock = readLock(lockPathFor(manifest))
  if (lock === undefined) throw new Error('the benchmark manifest resolved but wrote no lock')
  return { manifest, resolutionHash: lock.resolutionHash }
}

/** production refuses to serve assets built for another assembly; say so before it does */
export const assertStagedAssets = (resolutionHash: string): void => {
  const staged = path.join(repoRoot, 'packages/plugins/infra/web/client-dist/.qualy-assembly.json')
  if (!fs.existsSync(staged)) {
    throw new Error(`no staged web assets at ${staged}; run \`pnpm build\` first`)
  }
  const built = JSON.parse(fs.readFileSync(staged, 'utf8')) as { resolutionHash?: string }
  if (built.resolutionHash !== resolutionHash) {
    throw new Error(
      `the staged web assets were built for ${built.resolutionHash ?? '(unknown)'}, this assembly resolves to ${resolutionHash}; run \`pnpm build\``,
    )
  }
}

/** the sandbox is its own lifecycle; this only requires it to be up */
export const requireSandbox = (): { containerId: string } => {
  for (const socket of [RUNTIME_SOCKET, AUTHORING_SOCKET]) {
    if (!fs.existsSync(path.join(repoRoot, socket))) {
      throw new Error(`sandbox socket not found at ${socket}; run \`pnpm sandbox:up\` first`)
    }
  }
  const out = execFileSync(
    'docker',
    ['compose', '--profile', 'sandbox', 'ps', '-q', 'sandbox-runtime'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim()
  if (out === '') throw new Error('sandbox-runtime is not running; run `pnpm sandbox:up` first')
  return { containerId: out.split('\n')[0]! }
}

/** the container's cpu time, in seconds, from its own cgroup; null when it cannot be read */
export const sandboxCpuSeconds = (containerId: string): number | null => {
  try {
    const out = execFileSync('docker', ['exec', containerId, 'cat', '/sys/fs/cgroup/cpu.stat'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const usage = /usage_usec (\d+)/.exec(out)
    return usage ? Number(usage[1]) / 1_000_000 : null
  } catch {
    return null
  }
}

/** the server process, from the process table: resident bytes and cpu seconds so far */
export const sampleProcess = (pid: number): { rssBytes: number; cpuSeconds: number } | null => {
  try {
    const out = execFileSync('ps', ['-o', 'rss=,cputime=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const [rss, time] = out.split(/\s+/)
    if (rss === undefined || time === undefined) return null
    const parts = time.split(':').map(Number)
    const cpuSeconds =
      parts.length === 3
        ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
        : parts.length === 2
          ? parts[0]! * 60 + parts[1]!
          : Number(time)
    return { rssBytes: Number(rss) * 1024, cpuSeconds }
  } catch {
    return null
  }
}

export interface LogLine {
  readonly level: string
  readonly message: string
  readonly raw: string
}

export interface RunningServer {
  readonly pid: number
  readonly base: string
  readonly lines: readonly LogLine[]
  readonly ready: () => Promise<{ listeningMs: number | null }>
  readonly stop: () => Promise<{
    exitCode: number | null
    shutdownMs: number
    finalizers: readonly { name: string; ms: number }[]
    stillReleasing: string | null
    timedOut: boolean
  }>
  readonly kill: () => void
}

/**
 * The real production entry, the way `pnpm start` runs it, over the
 * benchmark assembly and database - and never inheriting the two variables
 * that would make it something else: the runner decides NODE_ENV, and
 * migrations stay off, as a deployment has them.
 */
export const startServer = (options: {
  readonly port: number
  readonly manifest: string
  readonly databaseUrl: string
  readonly otlpEndpoint: string
  readonly level: 'info' | 'debug'
}): RunningServer => {
  const { QUALY_MIGRATIONS: _migrations, NODE_ENV: _mode, ...inherited } = process.env
  const child: ChildProcess = spawn(
    process.execPath,
    ['--env-file-if-exists=.env', path.join(repoRoot, 'apps/server/src/run.ts'), 'production'],
    {
      cwd: repoRoot,
      env: {
        ...inherited,
        PORT: String(options.port),
        QUALY_CONFIG: options.manifest,
        DATABASE_URL: options.databaseUrl,
        QUALY_LOG_FORMAT: 'json',
        QUALY_LOG_LEVEL: options.level,
        QUALY_ACCESS_LOG: 'off',
        QUALY_BOOT_TIMING: '1',
        QUALY_SHUTDOWN_TIMEOUT: '25',
        OTEL_EXPORTER_OTLP_ENDPOINT: options.otlpEndpoint,
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_METRIC_EXPORT_INTERVAL: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const lines: LogLine[] = []
  let pending = ''
  const consume = (chunk: Buffer) => {
    pending += chunk.toString()
    const parts = pending.split('\n')
    pending = parts.pop() ?? ''
    for (const raw of parts) {
      if (raw.trim() === '') continue
      try {
        const parsed = JSON.parse(raw) as { level?: string; message?: string }
        lines.push({ level: parsed.level ?? '', message: parsed.message ?? '', raw })
      } catch {
        lines.push({ level: '', message: raw, raw })
      }
    }
  }
  child.stdout!.on('data', consume)
  child.stderr!.on('data', consume)
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  const base = `http://127.0.0.1:${options.port}`
  const bootMark = (name: string): number | null => {
    const found = lines.find(
      (line) => line.message.startsWith('boot ') && line.message.endsWith(name),
    )
    const ms = found ? /^boot (\d+)ms/.exec(found.message) : null
    return ms ? Number(ms[1]) : null
  }

  return {
    pid: child.pid!,
    base,
    lines,
    ready: async () => {
      // readiness includes the database probe, so give it time
      const deadline = Date.now() + 90_000
      for (;;) {
        const status = await fetch(`${base}/health/ready`).then(
          (response) => response.status,
          () => 0,
        )
        if (status === 200) break
        if (child.exitCode !== null) {
          throw new Error(
            `the server exited ${child.exitCode} before becoming ready:\n${lines.map((line) => line.raw).join('\n')}`,
          )
        }
        if (Date.now() > deadline) throw new Error('the server never became ready')
        await delay(500)
      }
      return { listeningMs: bootMark('http listening') }
    },
    stop: async () => {
      const started = performance.now()
      child.kill('SIGTERM')
      const code = await Promise.race([exited, delay(40_000).then(() => 'timeout' as const)])
      const timedOut = code === 'timeout'
      if (timedOut) child.kill('SIGKILL')
      const finalizers = lines.flatMap((line) => {
        const done = /^shutdown finalizer done:\s+(\S+) (\d+)ms$/.exec(line.message)
        return done ? [{ name: done[1]!, ms: Number(done[2]) }] : []
      })
      const stuck = lines.find((line) => line.message.includes('still releasing'))
      return {
        exitCode: timedOut ? null : code,
        shutdownMs: Math.round(performance.now() - started),
        finalizers,
        stillReleasing: stuck?.message ?? null,
        timedOut,
      }
    },
    kill: () => child.kill('SIGKILL'),
  }
}

// --- the metrics the server exports, received here -----------------------

interface Attribute {
  readonly key: string
  readonly value: { readonly stringValue?: string; readonly intValue?: string | number }
}
interface NumberPoint {
  readonly attributes?: readonly Attribute[]
  readonly asInt?: number | string
  readonly asDouble?: number
}
interface HistogramPoint {
  readonly attributes?: readonly Attribute[]
  readonly count?: number | string
  readonly sum?: number
}
interface Metric {
  readonly name: string
  readonly sum?: { readonly dataPoints: readonly NumberPoint[] }
  readonly gauge?: { readonly dataPoints: readonly NumberPoint[] }
  readonly histogram?: { readonly dataPoints: readonly HistogramPoint[] }
}
interface MetricsBody {
  readonly resourceMetrics?: readonly {
    readonly scopeMetrics?: readonly { readonly metrics?: readonly Metric[] }[]
  }[]
}

/** one export from the server: every metric it knows, cumulative */
export interface Snapshot {
  readonly at: number
  readonly sequence: number
  readonly metrics: readonly Metric[]
}

export interface OtlpReceiver {
  readonly endpoint: string
  readonly latest: () => Snapshot | undefined
  readonly exports: () => number
  /** waits until at least `count` more exports have arrived */
  readonly awaitExports: (count: number, timeoutMs?: number) => Promise<Snapshot>
  readonly close: () => Promise<void>
}

export const startOtlpReceiver = async (port: number): Promise<OtlpReceiver> => {
  let latest: Snapshot | undefined
  let sequence = 0
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (request.method === 'POST' && request.url?.endsWith('/v1/metrics')) {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as MetricsBody
          const metrics = (body.resourceMetrics ?? []).flatMap((resource) =>
            (resource.scopeMetrics ?? []).flatMap((scope) => scope.metrics ?? []),
          )
          sequence += 1
          latest = { at: Date.now(), sequence, metrics }
        } catch {
          // a body this receiver cannot read is still answered: the exporter
          // must never be told to stop
        }
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    endpoint: `http://127.0.0.1:${port}`,
    latest: () => latest,
    exports: () => sequence,
    awaitExports: async (count, timeoutMs = 15_000) => {
      const target = sequence + count
      const deadline = Date.now() + timeoutMs
      while (sequence < target) {
        if (Date.now() > deadline) {
          throw new Error(
            `the server exported no metrics for ${timeoutMs}ms; is telemetry disabled?`,
          )
        }
        await delay(100)
      }
      return latest!
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

const attributesMatch = (
  point: { readonly attributes?: readonly Attribute[] },
  wanted: Readonly<Record<string, string>>,
): boolean =>
  Object.entries(wanted).every(([key, value]) =>
    (point.attributes ?? []).some(
      (attribute) =>
        attribute.key === key &&
        String(attribute.value.stringValue ?? attribute.value.intValue) === value,
    ),
  )

const numberOf = (point: NumberPoint): number =>
  point.asDouble ?? (point.asInt === undefined ? 0 : Number(point.asInt))

/** the sum over every data point of a counter whose attributes include `wanted` */
export const counterOf = (
  snapshot: Snapshot | undefined,
  name: string,
  wanted: Readonly<Record<string, string>> = {},
): number =>
  (snapshot?.metrics ?? [])
    .filter((metric) => metric.name === name)
    .flatMap((metric) => metric.sum?.dataPoints ?? [])
    .filter((point) => attributesMatch(point, wanted))
    .reduce((total, point) => total + numberOf(point), 0)

/** count and sum over every data point of a histogram whose attributes include `wanted` */
export const histogramOf = (
  snapshot: Snapshot | undefined,
  name: string,
  wanted: Readonly<Record<string, string>> = {},
): { count: number; sum: number } =>
  (snapshot?.metrics ?? [])
    .filter((metric) => metric.name === name)
    .flatMap((metric) => metric.histogram?.dataPoints ?? [])
    .filter((point) => attributesMatch(point, wanted))
    .reduce<{ count: number; sum: number }>(
      (total, point) => ({
        count: total.count + Number(point.count ?? 0),
        sum: total.sum + (point.sum ?? 0),
      }),
      { count: 0, sum: 0 },
    )

// --- arithmetic ----------------------------------------------------------

export interface Percentiles {
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
  readonly mean: number
}

export const percentiles = (values: readonly number[]): Percentiles => {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, mean: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!
  return {
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
  }
}
