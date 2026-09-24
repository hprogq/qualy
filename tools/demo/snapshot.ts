// The demonstration baseline, packed for a server to restore from.
//
//   pnpm demo:snapshot
//
// Writes data/demo-baseline/qualy-demo.dump (pg_dump custom format) and
// data/demo-baseline/storage.tar.gz (the attachments the database cites).
// Refuses a database holding anything encrypted: ciphertext is sealed with
// the key of the machine that wrote it and would not open on the server.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'
import { DEMO_STORAGE_ROOT } from './runtime.ts'
import { demoUrl } from './target.ts'

const OUT = 'data/demo-baseline'
const CONTAINER = 'qualy-postgres-demo'

const url = demoUrl()
const database = new URL(url).pathname.slice(1)
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
await pool.end()

fs.mkdirSync(OUT, { recursive: true })
const dump = execFileSync(
  'docker',
  ['exec', CONTAINER, 'pg_dump', '-U', 'qualy', '-Fc', '--no-owner', '--no-acl', database],
  {
    maxBuffer: 1024 * 1024 * 1024,
  },
)
fs.writeFileSync(path.join(OUT, 'qualy-demo.dump'), dump)
execFileSync('tar', ['-czf', path.join(OUT, 'storage.tar.gz'), '-C', DEMO_STORAGE_ROOT, '.'])
for (const file of ['qualy-demo.dump', 'storage.tar.gz']) {
  const size = fs.statSync(path.join(OUT, file)).size
  console.log(`${path.join(OUT, file)}  ${(size / 1024 / 1024).toFixed(1)} MB`)
}
