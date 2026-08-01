import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// destructive statements never leave `pnpm db:generate` silently: a freshly
// generated migration that drops tables, columns or whole schemas requires
// ALLOW_DESTRUCTIVE=1, or an explicit '-- destructive: approved' marker for
// reviewed destructive migrations.

const destructivePatterns = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  /\bdrop\s+schema\b[^;]*\bcascade\b/i,
]
const approvalMarker = /^--\s*destructive:\s*approved\s*$/m

export function scanDestructive(files: string[]): string[] {
  const hits: string[] = []
  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf8')
    if (approvalMarker.test(sql)) continue
    for (const pattern of destructivePatterns) {
      const match = pattern.exec(sql)
      if (match) hits.push(`${file}: ${match[0]}`)
    }
  }
  return hits
}

// default scope: migrations added or modified since the last commit, i.e.
// whatever the generate step that just ran has produced
function newMigrationFiles(): string[] {
  const status = execSync('git status --porcelain -- db/migrations', { encoding: 'utf8' })
  return status
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(
      (file) =>
        file.endsWith('.sql') || fs.statSync(file, { throwIfNoEntry: false })?.isDirectory(),
    )
    .flatMap((entry) => {
      const stat = fs.statSync(entry, { throwIfNoEntry: false })
      if (stat?.isDirectory()) {
        const file = path.join(entry, 'migration.sql')
        return fs.existsSync(file) ? [file] : []
      }
      return fs.existsSync(entry) ? [entry] : []
    })
}

// --all: scan the complete migration history; approved destructive migrations
// carry their '-- destructive: approved' marker forever, so a full scan stays
// clean and never depends on computing the right diff base
function allMigrationFiles(root = 'db/migrations'): string[] {
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { recursive: true })
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => path.join(root, entry))
    .filter((file) => path.basename(file) === 'migration.sql')
}

// --base-ref <ref>: scan migrations added or changed since <ref>
function diffMigrationFiles(baseRef: string): string[] {
  const diff = execSync(`git diff --name-only ${baseRef}...HEAD -- db/migrations`, {
    encoding: 'utf8',
  })
  return diff
    .split('\n')
    .filter((file) => file.endsWith('.sql'))
    .filter((file) => fs.existsSync(file))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const baseRefIndex = process.argv.indexOf('--base-ref')
  const baseRef = baseRefIndex >= 0 ? process.argv[baseRefIndex + 1] : undefined
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('-') && fs.existsSync(arg))
  const scanAll = process.argv.includes('--all')
  const files = scanAll
    ? allMigrationFiles()
    : baseRef
      ? diffMigrationFiles(baseRef)
      : args.length > 0
        ? args
        : newMigrationFiles()
  const hits = scanDestructive(files)
  if (hits.length > 0 && process.env.ALLOW_DESTRUCTIVE !== '1') {
    console.error('drop-guard: destructive statements detected, set ALLOW_DESTRUCTIVE=1 to proceed')
    for (const hit of hits) console.error(`  ${hit}`)
    process.exit(1)
  }
  console.log(`drop-guard: ok (${files.length} file(s) scanned)`)
}
