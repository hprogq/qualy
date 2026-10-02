import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { MIGRATION_FILE } from '../../packages/plugins/infra/database/src/defaults.ts'
import { rolloutOf } from '../../packages/plugins/infra/database/src/assembly/rollout.ts'
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
// And say how it rolls out: `-- rollout: expand` when the release before it
// keeps working on what it leaves, `-- rollout: maintenance` when it does not
// (packages/plugins/infra/database/src/assembly/rollout.ts). Generation
// writes its guess; a migration added without either is refused, because the
// upgrade script would have to guess instead.
//
//   node tools/quality/check-migrations-immutable.ts <base-ref>
//
// CI passes the pull request's base or the pushed-over commit. A brand-new
// branch's zero sha is a pass, not a guess: there is nothing to compare
// against. A pushed-over commit that a force push left out of the clone is
// fetched by id first (see the workflow); one that still is not here fails.
//
// What is added is what HEAD has and the base does not. The diff runs from
// the merge base, so a branch behind its base is not charged with the base's
// newer files; but after a rewritten history the merge base lies before
// migrations the base already holds, and those are not new to the lineage.
// A file the base holds under the same name is compared by content instead.

const base = process.argv[2]
if (!base) {
  console.error('usage: node tools/quality/check-migrations-immutable.ts <base-ref>')
  process.exit(2)
}

const git = (args: readonly string[]) =>
  execFileSync('git', [...args], { cwd: repoRoot, encoding: 'utf8' }).trim()

const rolloutOverrides = new Map(
  fs
    .readFileSync(path.join(repoRoot, 'db/migration-rollout-overrides.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [name, rollout, ...extra] = line.split(/\s+/)
      if (
        name === undefined ||
        (rollout !== 'expand' && rollout !== 'maintenance') ||
        extra.length > 0
      )
        throw new Error(`invalid db/migration-rollout-overrides.txt line: ${line}`)
      return [name, rollout] as const
    }),
)

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

/**
 * Rollout metadata repaired after these migrations were committed. New
 * migrations cannot use the external file: they still put the marker in SQL.
 */
const ACKNOWLEDGED_ROLLOUT_OVERRIDES: ReadonlyMap<string, 'expand' | 'maintenance'> = new Map([
  ['20260928014855_attachment-storage-version.sql', 'expand'],
])

for (const [name, rollout] of rolloutOverrides) {
  if (ACKNOWLEDGED_ROLLOUT_OVERRIDES.get(name) !== rollout) {
    console.error(`check-migrations-immutable: unacknowledged rollout override: ${name} ${rollout}`)
    process.exit(1)
  }
}
for (const [name, rollout] of ACKNOWLEDGED_ROLLOUT_OVERRIDES) {
  if (rolloutOverrides.get(name) !== rollout) {
    console.error(
      `check-migrations-immutable: acknowledged rollout override is missing or changed: ${name} ${rollout}`,
    )
    process.exit(1)
  }
}

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

/** each migration file at a ref, by path, with the blob it holds */
const blobsAt = (ref: string) =>
  new Map(
    git(['ls-tree', '-r', ref, '--', 'db/migrations'])
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [meta, file] = line.split('\t') as [string, string]
        return [file, meta.split(' ')[2]!] as const
      }),
  )
const atBase = blobsAt(base)
const atHead = blobsAt('HEAD')

for (const [name] of rolloutOverrides) {
  const migration = `db/migrations/${name}`
  if (!atHead.has(migration)) {
    console.error(`check-migrations-immutable: rollout override names no HEAD migration: ${name}`)
    process.exit(1)
  }
  if (rolloutOf(git(['show', `HEAD:${migration}`])) !== undefined) {
    console.error(
      `check-migrations-immutable: ${name} has rollout metadata in both its SQL and the legacy override file`,
    )
    process.exit(1)
  }
  if (!atBase.has(migration) && !ACKNOWLEDGED_ROLLOUT_OVERRIDES.has(name)) {
    console.error(
      `check-migrations-immutable: ${name} is new since ${base}; new migrations put rollout metadata in their SQL, not the legacy override file`,
    )
    process.exit(1)
  }
}

const addedPaths = git([
  'diff',
  '--name-only',
  '--diff-filter=A',
  `${base}...HEAD`,
  '--',
  'db/migrations',
])
  .split('\n')
  .filter((line) => line !== '')

// already on the base: the same file is not an addition, a different one is an edit
const rewritten = addedPaths.filter(
  (file) => atBase.has(file) && atBase.get(file) !== atHead.get(file),
)
if (rewritten.length > 0) {
  console.error(
    `check-migrations-immutable: ${String(rewritten.length)} committed migration(s) differ from ${base}; a migration is fixed forward with a new file, never edited:`,
  )
  for (const file of rewritten) console.error(`  ${file}`)
  process.exit(1)
}
const added = addedPaths
  .filter((file) => !atBase.has(file))
  .map((file) => path.posix.basename(file))

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

const silent = added.filter(
  (name) =>
    rolloutOf(git(['show', `HEAD:db/migrations/${name}`])) === undefined &&
    rolloutOverrides.get(name) === undefined,
)
if (silent.length > 0) {
  console.error(
    `check-migrations-immutable: ${String(silent.length)} added migration(s) do not say how they roll out. Add a line \`-- rollout: expand\` when the release before this one keeps working on what the migration leaves (it only adds), or \`-- rollout: maintenance\` when it does not; pnpm qualy generate writes its guess:`,
  )
  for (const name of silent) console.error(`  ${name}`)
  process.exit(1)
}

console.log(
  `check-migrations-immutable: the lineage only grew since ${base}, at its end (${String(added.length)} migration(s) added after ${head ?? 'nothing'}, each carrying rollout metadata)`,
)
