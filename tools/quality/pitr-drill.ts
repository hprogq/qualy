import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Point-in-time recovery, proven on a PostgreSQL nobody uses: the technique
// the nightly dump cannot give (it loses up to a day), shown to work with the
// image production runs before anybody decides to run it there.
//
//   node tools/quality/pitr-drill.ts
//
// A database archives its WAL to a directory; a base backup is taken; rows
// A, B and C are written with a moment T noted between B and C; the WAL is
// archived and the database destroyed. A new one starts from the base backup
// and replays the archive up to T. It must hold A and B and not C. Nothing
// here has a network or touches a deployment; docs/notes/pitr.md says what
// production would additionally have to decide.

const repoRoot = path.resolve(import.meta.dirname, '../..')
const compose = fs.readFileSync(path.join(repoRoot, 'deploy/compose.yaml'), 'utf8')
const IMAGE = /image:\s*(\S*pgvector\S*)/.exec(compose)![1]!
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-pitr-'))
const archive = path.join(work, 'archive')
const base = path.join(work, 'base')
fs.mkdirSync(archive, { mode: 0o777 })
fs.mkdirSync(base, { mode: 0o777 })
fs.chmodSync(archive, 0o777)
fs.chmodSync(base, 0o777)
const first = `qualy-pitr-primary-${String(process.pid)}`
const second = `qualy-pitr-recovered-${String(process.pid)}`
const timings: Record<string, number> = {}

const docker = (args: readonly string[], input?: string) => {
  const ran = spawnSync('docker', args, { input, encoding: 'utf8' })
  return {
    code: ran.status ?? 1,
    out: `${ran.stdout ?? ''}`.trim(),
    err: `${ran.stderr ?? ''}`.trim(),
  }
}
const fail = (message: string): never => {
  console.error(`pitr-drill: FAIL ${message}`)
  docker(['rm', '-f', first, second])
  process.exit(1)
}
const psql = (container: string, sql: string) => {
  const ran = docker([
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ])
  if (ran.code !== 0) fail(`${container}: ${sql}: ${ran.err}`)
  return ran.out
}
const ready = (container: string) => {
  for (let at = 0; at < 120; at += 1) {
    if (
      docker(['exec', container, 'pg_isready', '-U', 'postgres']).code === 0 &&
      docker(['exec', container, 'psql', '-U', 'postgres', '-c', 'select 1']).code === 0
    )
      return
    spawnSync('sleep', ['1'])
  }
  fail(`${container} did not become ready:\n${docker(['logs', '--tail', '30', container]).err}`)
}
const timed = <T>(name: string, run: () => T): T => {
  const started = performance.now()
  const value = run()
  timings[name] = Math.round(performance.now() - started)
  return value
}

try {
  // a database that archives every finished WAL segment
  timed('primary start', () => {
    const started = docker([
      'run',
      '-d',
      '--name',
      first,
      '--network',
      'none',
      '-e',
      'POSTGRES_PASSWORD=pitr',
      '-v',
      `${archive}:/archive`,
      '-v',
      `${base}:/base`,
      IMAGE,
      '-c',
      'wal_level=replica',
      '-c',
      'archive_mode=on',
      '-c',
      'archive_command=test ! -f /archive/%f && cp %p /archive/%f',
      '-c',
      'archive_timeout=60',
    ])
    if (started.code !== 0) fail(started.err)
    ready(first)
  })
  psql(first, `create table drill (row text primary key, at timestamptz default clock_timestamp())`)
  psql(first, `insert into drill (row) values ('A')`)

  // the base backup the replay starts from, the WAL left to the archive
  timed('base backup', () => {
    const backed = docker([
      'exec',
      '-u',
      'postgres',
      first,
      'pg_basebackup',
      '-D',
      '/base/data',
      '-X',
      'none',
      '-c',
      'fast',
    ])
    if (backed.code !== 0) fail(`pg_basebackup: ${backed.err}`)
  })
  psql(first, `insert into drill (row) values ('B')`)
  const target = psql(first, `select clock_timestamp()`)
  spawnSync('sleep', ['1'])
  psql(first, `insert into drill (row) values ('C')`)
  psql(first, `select pg_switch_wal()`)
  // wait for the segment holding C to reach the archive
  for (let at = 0; at < 60; at += 1) {
    const archived = Number(psql(first, `select archived_count from pg_stat_archiver`))
    if (archived >= 2) break
    spawnSync('sleep', ['1'])
  }
  const segments = fs.readdirSync(archive).filter((name) => /^[0-9A-F]{24}$/.test(name)).length
  docker(['rm', '-f', first])

  // a new server from the base backup, replaying the archive up to T
  const recovery = timed('recovery', () => {
    fs.writeFileSync(path.join(base, 'data', 'recovery.signal'), '')
    fs.appendFileSync(
      path.join(base, 'data', 'postgresql.auto.conf'),
      `restore_command = 'cp /archive/%f %p'\nrecovery_target_time = '${target}'\nrecovery_target_action = 'promote'\n`,
    )
    const started = docker([
      'run',
      '-d',
      '--name',
      second,
      '--network',
      'none',
      '-e',
      'POSTGRES_PASSWORD=pitr',
      '-e',
      'PGDATA=/base/data',
      '-v',
      `${archive}:/archive:ro`,
      '-v',
      `${base}:/base`,
      IMAGE,
    ])
    if (started.code !== 0) fail(started.err)
    ready(second)
    return psql(second, `select string_agg(row, ',' order by row) from drill`)
  })
  const log = docker(['logs', second]).err
  const reached = /recovery stopping before commit of transaction \d+, time ([^\n]+)/.exec(log)?.[1]

  const ok = recovery === 'A,B'
  console.log(
    `${ok ? 'PASS' : 'FAIL'} restored to ${target}: rows ${recovery} (expected A,B; C was written after)`,
  )
  console.log(
    `      the replay stopped before the commit at ${reached ?? '?'}; ${String(segments)} WAL segment(s) archived`,
  )
  for (const [name, ms] of Object.entries(timings))
    console.log(`      ${name}: ${(ms / 1000).toFixed(1)} s`)
  if (!ok) process.exitCode = 1
} finally {
  docker(['rm', '-f', first, second])
  // the base backup is written by the container's postgres user
  spawnSync('docker', [
    'run',
    '--rm',
    '-v',
    `${work}:/work`,
    IMAGE,
    'rm',
    '-rf',
    '/work/archive',
    '/work/base',
  ])
  fs.rmSync(work, { recursive: true, force: true })
}
