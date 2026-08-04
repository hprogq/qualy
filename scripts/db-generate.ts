import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  collectBaseline,
  compiledBaseline,
  pendingBaseline,
  renderBaseline,
  type BaselineFragment,
} from './lib/baseline.ts'

// Generation for the whole assembly: the tables drizzle derives from the
// aggregated schema, plus the SQL each plugin owns that drizzle cannot see.
//
// Both have to land in one migration and in the right order. An extension is
// pre-structure because a column type depends on it; a trigger is
// post-structure because the table it guards has to exist first. Splitting
// them across two migrations would leave a window where the lineage does not
// apply to an empty database, which is exactly the failure this replaces.

const MIGRATIONS = 'db/migrations'
const BREAK = '--> statement-breakpoint'

const drizzle = (args: readonly string[]) =>
  execFileSync('./node_modules/.bin/drizzle-kit', args, { encoding: 'utf8' })

const migrationDirs = () =>
  fs.existsSync(MIGRATIONS)
    ? fs
        .readdirSync(MIGRATIONS)
        .filter((dir) => fs.existsSync(path.join(MIGRATIONS, dir, 'migration.sql')))
        .sort()
    : []

const name = (() => {
  const flag = process.argv.indexOf('--name')
  return flag >= 0 ? process.argv[flag + 1] : undefined
})()

const fragments = collectBaseline()
const pending = pendingBaseline(fragments, compiledBaseline(MIGRATIONS))

const before = new Set(migrationDirs())
drizzle(['generate', ...(name ? ['--name', name] : [])])
let created = migrationDirs().find((dir) => !before.has(dir))

if (!created && pending.length > 0) {
  // no table changed, but a plugin declared sql that is not in the lineage
  // yet; an empty migration is the carrier drizzle offers for that
  drizzle(['generate', '--custom', '--name', name ?? 'baseline'])
  created = migrationDirs().find((dir) => !before.has(dir))
}

if (!created) {
  console.log(
    pending.length === 0
      ? 'db:generate: nothing to do'
      : 'db:generate: no migration produced despite pending baseline fragments',
  )
  process.exit(pending.length === 0 ? 0 : 1)
}

if (pending.length > 0) {
  const file = path.join(MIGRATIONS, created, 'migration.sql')
  // an empty custom migration arrives carrying drizzle's placeholder comment,
  // which is not structure and should not be framed as such
  const structure = fs
    .readFileSync(file, 'utf8')
    .replace(/^--\s*Custom SQL migration file.*$/m, '')
    .trim()
  const section = (phase: BaselineFragment['phase']) =>
    pending
      .filter((fragment) => fragment.phase === phase)
      .map((fragment) => renderBaseline(fragment))
  const parts = [...section('pre-structure'), ...(structure ? [structure] : []), ...section('post-structure')]
  fs.writeFileSync(file, `${parts.join(`${BREAK}\n\n`)}\n`)
  for (const fragment of pending) {
    console.log(`db:generate: compiled ${fragment.plugin} ${fragment.file} (${fragment.phase})`)
  }
}

console.log(`db:generate: ${created}`)
execFileSync('./node_modules/.bin/tsx', ['scripts/drop-guard.ts'], { stdio: 'inherit' })
