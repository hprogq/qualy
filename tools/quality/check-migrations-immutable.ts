import { execFileSync } from 'node:child_process'
import { repoRoot } from '../lib/manifest.ts'

// A committed migration is history: once it is on main it has been applied
// somewhere, and the ledger records it by name only. Editing it in place
// changes nothing on any database that already ran it and everything on the
// next fresh one; deleting or renaming it leaves a ledger entry nothing
// explains. So between a base and HEAD the lineage may only grow.
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

if (changed.length > 0) {
  console.error(
    `check-migrations-immutable: ${String(changed.length)} committed migration(s) changed since ${base}; a migration is fixed forward with a new file, never edited:`,
  )
  for (const line of changed) console.error(`  ${line}`)
  process.exit(1)
}

const added = git([
  'diff',
  '--name-only',
  '--diff-filter=A',
  `${base}...HEAD`,
  '--',
  'db/migrations',
])
  .split('\n')
  .filter((line) => line !== '').length
console.log(
  `check-migrations-immutable: the lineage only grew since ${base} (${String(added)} migration(s) added)`,
)
