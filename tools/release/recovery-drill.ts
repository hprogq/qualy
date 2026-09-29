import { createHash } from 'node:crypto'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A backup, restored where nothing can reach it, and checked for being one.
//
//   node tools/release/recovery-drill.ts <backup-dir> [--summary <file.json>]
//     [--downloaded-in <seconds>]
//
// <backup-dir> is what deploy/backup.sh writes: qualy.dump, storage.tar.gz,
// attachments.tar.gz (newer backups) and SHA256SUMS. The drill proves what a
// restore needs and a copy does not show: the sums hold, the dump restores
// into an empty PostgreSQL of the version production runs, its migration
// ledger belongs to this lineage, and every attachment a row names is in the
// archive with the size and fingerprint the row recorded. It times each part,
// so a recovery has a measured duration rather than a guessed one.
//
// Nothing it starts can reach anything: the database runs in a container with
// no network, under a name of its own, and is removed however the drill ends.
// It never connects to a deployment; the backup is the only input.

const repoRoot = path.resolve(import.meta.dirname, '../..')

interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

const checks: Check[] = []
const timings: Record<string, number> = {}
const facts: Record<string, string | number> = {}

const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(22)} ${detail}`)
}

const timed = <T>(name: string, run: () => T): T => {
  const started = performance.now()
  try {
    return run()
  } finally {
    timings[name] = Math.round(performance.now() - started)
  }
}

const refuse = (message: string): never => {
  console.error(`recovery drill: ${message}`)
  process.exit(2)
}

const run = (command: string, args: readonly string[], input?: Buffer | number) => {
  const result: SpawnSyncReturns<Buffer> = spawnSync(command, args, {
    input: typeof input === 'number' ? undefined : input,
    stdio: [typeof input === 'number' ? input : 'pipe', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 1024,
  })
  return {
    code: result.status ?? 1,
    out: result.stdout?.toString('utf8') ?? '',
    err: result.stderr?.toString('utf8') ?? '',
  }
}

/** the PostgreSQL image production runs, from the compose file the release carries */
const productionPostgres = (): string => {
  const compose = fs.readFileSync(path.join(repoRoot, 'deploy/compose.yaml'), 'utf8')
  const image = /image:\s*(\S*(?:postgres|pgvector)\S*)/.exec(compose)?.[1]
  return image ?? refuse('deploy/compose.yaml names no postgres image')
}

const sha256Of = (file: string): string => {
  const hash = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024)
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null)
      if (read === 0) break
      hash.update(chunk.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

const mebibytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`

/** a backup directory's name is the UTC moment it was taken */
export const stampTime = (name: string): Date | undefined => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(name)
  if (match === null) return undefined
  const [, y, mo, d, h, mi, s] = match
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`)
}

/** SHA256SUMS as sha256sum writes it: `<hex>  <name>` per line */
export const parseSums = (text: string): Map<string, string> =>
  new Map(
    text
      .split('\n')
      .map((line) => /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[2]!, match[1]!]),
  )

/** the ledger names this checkout's lineage holds, oldest first */
const committedLineage = (): string[] =>
  fs
    .readdirSync(path.join(repoRoot, 'db/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()

/**
 * How a restored ledger stands against this checkout's lineage: a backup is
 * restorable here when every migration it applied is one this lineage has -
 * an older backup is simply behind and `qualy deploy` brings it forward.
 */
export const ledgerAgainst = (applied: readonly string[], lineage: readonly string[]) => {
  const known = new Set(lineage)
  const foreign = applied.filter((name) => !known.has(name))
  const behind = lineage.length - applied.filter((name) => known.has(name)).length
  return { foreign, behind }
}

interface AttachmentRow {
  readonly id: string
  readonly backend: string
  readonly key: string
  readonly size: number
  readonly algorithm: string
  readonly integrity: string
}

/** the file a row names, the size it recorded and the fingerprint, where one can be computed */
const fileMatches = (file: string, row: AttachmentRow): string | undefined => {
  if (!fs.existsSync(file)) return 'missing'
  const size = fs.statSync(file).size
  if (size !== row.size) return `size ${String(size)}, row says ${String(row.size)}`
  if (row.algorithm === 'sha256' && sha256Of(file) !== row.integrity) return 'fingerprint differs'
  return undefined
}

const main = () => {
  const args = process.argv.slice(2)
  const backup = path.resolve(
    args[0] ?? refuse('usage: recovery-drill.ts <backup-dir> [--summary <file>]'),
  )
  const summaryAt = args.indexOf('--summary')
  const summaryFile = summaryAt >= 0 ? args[summaryAt + 1] : undefined
  // fetching it is part of recovering from it, and only the caller saw that
  const downloadedAt = args.indexOf('--downloaded-in')
  if (downloadedAt >= 0) timings['download'] = Math.round(Number(args[downloadedAt + 1]) * 1000)
  const drillStarted = performance.now()

  for (const file of ['qualy.dump', 'storage.tar.gz', 'SHA256SUMS']) {
    if (!fs.existsSync(path.join(backup, file))) refuse(`${backup} has no ${file}`)
  }
  const taken = stampTime(path.basename(backup))
  if (taken !== undefined) {
    facts['backup'] = path.basename(backup)
    facts['backup age (h)'] = Number(((Date.now() - taken.getTime()) / 3_600_000).toFixed(1))
  }
  const bytes = fs
    .readdirSync(backup)
    .reduce((sum, name) => sum + fs.statSync(path.join(backup, name)).size, 0)
  facts['backup size'] = mebibytes(bytes)

  // 1. every file against its recorded sum, and every archive file listed
  timed('sums', () => {
    const sums = parseSums(fs.readFileSync(path.join(backup, 'SHA256SUMS'), 'utf8'))
    const archives = ['qualy.dump', 'storage.tar.gz', 'attachments.tar.gz'].filter((name) =>
      fs.existsSync(path.join(backup, name)),
    )
    const unlisted = archives.filter((name) => !sums.has(name))
    const wrong = [...sums].filter(([name, sum]) => sha256Of(path.join(backup, name)) !== sum)
    check(
      'sums',
      unlisted.length === 0 && wrong.length === 0,
      unlisted.length > 0
        ? `not in SHA256SUMS: ${unlisted.join(', ')}`
        : wrong.length > 0
          ? `differ: ${wrong.map(([name]) => name).join(', ')}`
          : `${String(sums.size)} file(s) match`,
    )
  })

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-drill-'))
  const container = `qualy-recovery-drill-${String(process.pid)}`
  const image = productionPostgres()
  const psql = (sql: string) =>
    run('docker', [
      'exec',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'drill',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ])

  try {
    // 2. an empty database of the version production runs, reachable by nothing
    timed('database start', () => {
      const started = run('docker', [
        'run',
        '-d',
        '--rm',
        '--name',
        container,
        '--network',
        'none',
        '-e',
        'POSTGRES_PASSWORD=drill',
        '-e',
        'POSTGRES_DB=drill',
        image,
      ])
      if (started.code !== 0) refuse(`docker run ${image}: ${started.err.trim()}`)
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const ready = run('docker', [
          'exec',
          container,
          'pg_isready',
          '-U',
          'postgres',
          '-d',
          'drill',
        ])
        // the entrypoint restarts the server once after init; ask twice apart
        if (ready.code === 0 && psql('select 1').code === 0) return
        spawnSync('sleep', ['1'])
      }
      refuse('the drill database did not become ready')
    })

    // 3. the dump, all or nothing
    const restored = timed('database restore', () =>
      run(
        'docker',
        [
          'exec',
          '-i',
          container,
          'pg_restore',
          '-U',
          'postgres',
          '-d',
          'drill',
          '--no-owner',
          '--no-acl',
          '--exit-on-error',
        ],
        fs.openSync(path.join(backup, 'qualy.dump'), 'r'),
      ),
    )
    check(
      'restore',
      restored.code === 0,
      restored.code === 0 ? 'pg_restore exited 0' : restored.err.trim().slice(-400),
    )
    if (restored.code !== 0) return

    facts['database size'] = psql(
      'select pg_size_pretty(pg_database_size(current_database()))',
    ).out.trim()

    // 4. the ledger is this lineage's
    const applied = psql('select name from mikro_orm_migrations order by name')
      .out.split('\n')
      .filter(Boolean)
    const { foreign, behind } = ledgerAgainst(applied, committedLineage())
    check(
      'migration ledger',
      applied.length > 0 && foreign.length === 0,
      foreign.length > 0
        ? `applied migrations this lineage lacks: ${foreign.slice(0, 3).join(', ')}`
        : `${String(applied.length)} applied, ${String(behind)} behind this checkout`,
    )

    // 5. the rows a deployment cannot start without, and the size of what it holds
    const count = (table: string) => {
      const found = psql(`select count(*) from ${table}`)
      return found.code === 0 ? Number(found.out.trim()) : -1
    }
    const tenants = count('tenants')
    const users = count('users')
    check(
      'core rows',
      tenants >= 1 && users >= 1,
      `tenants ${String(tenants)}, users ${String(users)}`,
    )
    for (const table of ['entries', 'entry_revisions', 'audit_events', 'assessment_batches']) {
      const rows = count(table)
      if (rows >= 0) facts[`rows: ${table}`] = rows
    }

    // 6. every attachment a row names, with the size and fingerprint it recorded
    const rows: AttachmentRow[] = psql(
      `select id, backend, storage_key, size, integrity_algorithm, integrity_value
         from storage_attachments where status in ('staged', 'bound', 'retired') order by id`,
    )
      .out.split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, backend, key, size, algorithm, integrity] = line.split('|')
        return {
          id: id!,
          backend: backend!,
          key: key!,
          size: Number(size),
          algorithm: algorithm!,
          integrity: integrity!,
        }
      })
    facts['attachments'] = rows.length
    timed('attachments', () => {
      const local = path.join(work, 'storage')
      fs.mkdirSync(local)
      const unpacked = run('tar', ['-xzf', path.join(backup, 'storage.tar.gz'), '-C', local])
      if (unpacked.code !== 0) refuse(`storage.tar.gz: ${unpacked.err.trim()}`)
      const exported = path.join(work, 'exported')
      fs.mkdirSync(exported)
      const hasExport = fs.existsSync(path.join(backup, 'attachments.tar.gz'))
      if (hasExport) {
        const opened = run('tar', ['-xzf', path.join(backup, 'attachments.tar.gz'), '-C', exported])
        if (opened.code !== 0) refuse(`attachments.tar.gz: ${opened.err.trim()}`)
      }
      const problems: string[] = []
      let remote = 0
      for (const row of rows) {
        const file =
          row.backend === 'local'
            ? path.join(local, row.key)
            : path.join(exported, row.backend, row.key)
        if (row.backend !== 'local') remote += 1
        if (row.backend !== 'local' && !hasExport) {
          problems.push(
            `${row.id}: kept by ${row.backend}, and this backup has no attachments.tar.gz`,
          )
          continue
        }
        const wrong = fileMatches(file, row)
        if (wrong !== undefined) problems.push(`${row.id} (${row.backend}): ${wrong}`)
      }
      facts['attachments kept remotely'] = remote
      check(
        'attachments',
        problems.length === 0,
        problems.length === 0
          ? `${String(rows.length)} present with their recorded size and fingerprint`
          : `${String(problems.length)} of ${String(rows.length)} wrong, first: ${problems[0]!}`,
      )
    })
  } finally {
    run('docker', ['rm', '-f', container])
    fs.rmSync(work, { recursive: true, force: true })
    timings['total'] = Math.round(performance.now() - drillStarted) + (timings['download'] ?? 0)
  }

  const failed = checks.filter((one) => !one.ok)
  console.log('')
  for (const [name, value] of Object.entries(facts))
    console.log(`${name.padEnd(26)} ${String(value)}`)
  for (const [name, ms] of Object.entries(timings))
    console.log(`${`time: ${name}`.padEnd(26)} ${(ms / 1000).toFixed(1)} s`)
  const summary = { ok: failed.length === 0, checks, facts, timingsMs: timings, image }
  if (summaryFile !== undefined)
    fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`)
  if (process.env['GITHUB_STEP_SUMMARY']) {
    const lines = [
      `### Recovery drill: ${failed.length === 0 ? 'restored and whole' : `${String(failed.length)} check(s) failed`}`,
      '',
      '| check | result | detail |',
      '| --- | --- | --- |',
      ...checks.map((one) => `| ${one.name} | ${one.ok ? 'pass' : '**fail**'} | ${one.detail} |`),
      '',
      '| fact | value |',
      '| --- | --- |',
      ...Object.entries(facts).map(([name, value]) => `| ${name} | ${String(value)} |`),
      ...Object.entries(timings).map(
        ([name, ms]) => `| time: ${name} | ${(ms / 1000).toFixed(1)} s |`,
      ),
      '',
    ]
    fs.appendFileSync(process.env['GITHUB_STEP_SUMMARY'], lines.join('\n'))
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

if (import.meta.main) main()
