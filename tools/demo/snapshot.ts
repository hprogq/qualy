// The demonstration baseline, packed for a server to restore from.
//
//   pnpm demo:snapshot
//
// Writes data/demo-baseline/qualy-demo.dump (pg_dump custom format) and
// data/demo-baseline/storage.tar.gz (the attachments the database cites).
// Refuses a database holding anything encrypted: ciphertext is sealed with
// the key of the machine that wrote it and would not open on the server.
// Refuses, too, one holding what a sign-in on this machine leaves behind
// (sessions, rate-limit buckets, pending mail challenges, spent CAPTCHA
// challenges): none of it is part of the story, and a session restored on
// the server would still open for the browser that made it here.
//
//   pnpm demo:snapshot --clear-runtime   deletes those rows first

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'
import { DEMO_STORAGE_ROOT } from './runtime.ts'
import { DEMO_URL_VARIABLE, demoUrl, snapshotDatabaseOf } from './target.ts'
import { prepareSnapshotOutput } from './snapshot-output.ts'

const OUT = process.env.QUALY_DEMO_SNAPSHOT_ROOT ?? 'data/demo-baseline'
const CONTAINER = 'qualy-postgres-demo'

const database = snapshotDatabaseOf(process.env[DEMO_URL_VARIABLE] ?? '')
const url = demoUrl()
process.umask(0o077)
const pool = new Pool({ connectionString: url })
for (const table of ['secrets', 'auth_flows', 'session_auth_grants']) {
  const rows = (await pool.query<{ n: string }>(`select count(*)::text as n from ${table}`))
    .rows[0]!.n
  if (rows !== '0') {
    await pool.end()
    throw new Error(
      `${table} holds ${rows} row(s) sealed with this machine's key; the baseline would not open elsewhere`,
    )
  }
}
const RUNTIME = [
  'sessions',
  'auth_rate_limit_buckets',
  'user_email_challenges',
  'captcha_altcha_used_challenges',
] as const
const clear = process.argv.includes('--clear-runtime')
for (const table of RUNTIME) {
  if (clear) {
    const removed = await pool.query(`delete from ${table}`)
    if (removed.rowCount !== 0) console.log(`${table}: ${removed.rowCount} row(s) deleted`)
    continue
  }
  const rows = (await pool.query<{ n: string }>(`select count(*)::text as n from ${table}`))
    .rows[0]!.n
  if (rows !== '0') {
    await pool.end()
    throw new Error(
      `${table} holds ${rows} row(s) left by using this copy; run again with --clear-runtime to delete them`,
    )
  }
}
// The archive is the files the database cites, and nothing else: a file no
// row names is a leftover from an earlier run, and one a row names but the
// folder lacks would be an attachment that cannot be opened on the server.
const cited = new Set(
  (
    await pool.query<{ key: string }>(
      `select storage_key as key from storage_attachments where backend = 'local'`,
    )
  ).rows.map((row) => row.key),
)
await pool.end()
const stored = new Set(
  fs
    .readdirSync(DEMO_STORAGE_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(DEMO_STORAGE_ROOT, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/'),
    ),
)
const uncited = [...stored].filter((key) => !cited.has(key))
const missing = [...cited].filter((key) => !stored.has(key))
if (uncited.length > 0 || missing.length > 0) {
  throw new Error(
    `${DEMO_STORAGE_ROOT} does not match the attachments the database cites: ` +
      `${uncited.length} file(s) no row names (first: ${uncited[0] ?? '-'}), ` +
      `${missing.length} cited file(s) missing (first: ${missing[0] ?? '-'}); ` +
      'pnpm demo:reset-db empties the folder with the database',
  )
}

const output = prepareSnapshotOutput(OUT)
const dump = execFileSync(
  'docker',
  ['exec', CONTAINER, 'pg_dump', '-U', 'qualy', '-Fc', '--no-owner', '--no-acl', database],
  {
    maxBuffer: 1024 * 1024 * 1024,
  },
)
fs.writeFileSync(output.dump, dump, { mode: 0o600 })
// without a Mac's AppleDouble `._` companions and extended attributes, which
// would otherwise land in the server's storage volume as files of their own
execFileSync('tar', ['--no-xattrs', '-czf', output.storage, '-C', DEMO_STORAGE_ROOT, '.'], {
  env: { ...process.env, COPYFILE_DISABLE: '1' },
})
for (const file of ['qualy-demo.dump', 'storage.tar.gz']) {
  fs.chmodSync(path.join(OUT, file), 0o600)
  const size = fs.statSync(path.join(OUT, file)).size
  console.log(`${path.join(OUT, file)}  ${(size / 1024 / 1024).toFixed(1)} MB`)
}
