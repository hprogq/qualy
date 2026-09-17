import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { MIGRATION_FILE } from '../../packages/plugins/infra/database/src/defaults.ts'
import { repoRoot } from '../lib/manifest.ts'

// A committed migration is history: once it is on main it has been applied
// somewhere, and the ledger records it by name only. Editing it in place
// changes nothing on any database that already ran it and everything on the
// next fresh one; deleting or renaming it leaves a ledger entry nothing
// explains. So between a base and HEAD the lineage may only grow.
//
// And grow at the end. The ledger records names, not positions: a migration
// added with an instant earlier than the last one the base already has runs
// after that one on every database that is already up to date, and before it
// on a fresh one - two orders for one lineage. That is what a branch opened
// before somebody else's migration landed produces when it merges, and what a
// clock behind the lineage produces anywhere. So every added file must be
// named by the lineage's rule and stamped strictly after the base's last
// migration. Until it is merged it can still be renamed to a later instant.
//
//   node tools/quality/check-migrations-immutable.ts <base-ref>
//
// CI passes the pull request's base or the pushed-over commit. A base that
// is not in this clone (a brand-new branch's zero sha) is a pass, not a
// guess: there is nothing to compare against.

const base = process.argv[2]
if (!base) {
  console.error('usage: node tools/quality/check-migrations-immutable.ts <base-ref>')
  process.exit(2)
}

const git = (args: readonly string[]) =>
  execFileSync('git', [...args], { cwd: repoRoot, encoding: 'utf8' }).trim()

if (/^0+$/.test(base)) {
  console.log('check-migrations-immutable: no base commit to compare against; nothing to check')
  process.exit(0)
}
try {
  git(['cat-file', '-e', `${base}^{commit}`])
} catch {
  console.error(`check-migrations-immutable: ${base} is not a commit in this clone`)
  process.exit(2)
}

/**
 * Renames made on purpose, each with why it was safe when it was made.
 *
 * A rename is refused because the ledger remembers the old name: a database
 * that applied the file finds the new name pending and runs it a second
 * time. It is safe only while no deployment has applied the file, and even
 * then a development database that did has its ledger row renamed by hand -
 * which is why each entry says how. Only a pure rename passes: git has to
 * report the content identical (R100), so the pair cannot hide an edit.
 */
const ACKNOWLEDGED_RENAMES: readonly { from: string; to: string; why: string }[] = [
  {
    from: 'db/migrations/20260916143334.sql',
    to: 'db/migrations/20260916143334_administrative-imports.sql',
    why: "the only migration committed without a name. No deployment had applied it; a development database that did runs: update mikro_orm_migrations set name = '20260916143334_administrative-imports.sql' where name = '20260916143334.sql'",
  },
]

const acknowledged = (line: string) => {
  const [status, from, to] = line.split('\t')
  return (
    status === 'R100' &&
    ACKNOWLEDGED_RENAMES.some((rename) => rename.from === from && rename.to === to)
  )
}

// modified, deleted, renamed, type-changed: everything but an addition
const changed = git([
  'diff',
  '--name-status',
  '--diff-filter=MDRT',
  `${base}...HEAD`,
  '--',
  'db/migrations',
])
  .split('\n')
  .filter((line) => line !== '')
  .filter((line) => !acknowledged(line))

if (changed.length > 0) {
  console.error(
    `check-migrations-immutable: ${String(changed.length)} committed migration(s) changed since ${base}; a migration is fixed forward with a new file, never edited:`,
  )
  for (const line of changed) console.error(`  ${line}`)
  process.exit(1)
}

const migrationsAt = (ref: string) =>
  git(['ls-tree', '-r', '--name-only', ref, '--', 'db/migrations'])
    .split('\n')
    .filter((line) => line.endsWith('.sql'))
    .map((line) => path.posix.basename(line))

const added = git([
  'diff',
  '--name-only',
  '--diff-filter=A',
  `${base}...HEAD`,
  '--',
  'db/migrations',
])
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => path.posix.basename(line))

const misnamed = added.filter((name) => !MIGRATION_FILE.test(name))
if (misnamed.length > 0) {
  console.error(
    `check-migrations-immutable: ${String(misnamed.length)} added file(s) under db/migrations are not named <yyyyMMddHHmmss>[_lowercase-name].sql:`,
  )
  for (const name of misnamed) console.error(`  ${name}`)
  process.exit(1)
}

// the base's head, not the merge base's: a branch opened before another
// migration landed on the base is exactly the case to catch
const head = migrationsAt(base)
  .map((name) => MIGRATION_FILE.exec(name)?.[1])
  .filter((stamp): stamp is string => stamp !== undefined)
  .sort()
  .at(-1)
const early =
  head === undefined ? [] : added.filter((name) => MIGRATION_FILE.exec(name)![1]! <= head)
if (early.length > 0) {
  console.error(
    `check-migrations-immutable: ${String(early.length)} added migration(s) are stamped at or before ${head}, the last migration ${base} already has. A database that already ran it would run these after it and a fresh one before it; regenerate them (pnpm qualy generate / pnpm qualy database custom stamp after the lineage) or rename them to a later instant before they merge:`,
  )
  for (const name of early) console.error(`  ${name}`)
  process.exit(1)
}

console.log(
  `check-migrations-immutable: the lineage only grew since ${base}, at its end (${String(added.length)} migration(s) added after ${head ?? 'nothing'})`,
)
