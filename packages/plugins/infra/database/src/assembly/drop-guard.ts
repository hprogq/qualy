import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Which migration files a scan covers, and what counts as destructive in one.
// The scan itself runs from generate; this file only decides the patterns and
// the file sets.

const destructivePatterns = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  /\bdrop\s+schema\b[^;]*\bcascade\b/i,
]
const approvalMarker = /^--\s*destructive:\s*approved\s*$/m

/**
 * What is destructive in one migration's SQL.
 *
 * Takes the text rather than a path, because generation has to be able to ask
 * before the file exists: a migration that fails the guard must never reach the
 * lineage, where the next run would read its baseline markers as compiled.
 */
export function destructiveIn(label: string, sql: string): string[] {
  if (approvalMarker.test(sql)) return []
  const hits: string[] = []
  for (const pattern of destructivePatterns) {
    const match = pattern.exec(sql)
    if (match) hits.push(`${label}: ${match[0]}`)
  }
  return hits
}

export function scanDestructive(files: readonly string[]): string[] {
  return files.flatMap((file) => destructiveIn(file, fs.readFileSync(file, 'utf8')))
}

/**
 * The complete lineage.
 *
 * Approved destructive migrations carry their '-- destructive: approved'
 * marker forever, so a full scan stays clean and never depends on computing
 * the right diff base.
 */
export function allMigrationFiles(migrations: string): string[] {
  if (!fs.existsSync(migrations)) return []
  return fs
    .readdirSync(migrations)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .map((entry) => path.join(migrations, entry))
}

/** migrations added or changed since a git ref */
export function changedMigrationFiles(migrations: string, baseRef: string): string[] {
  // argv rather than a shell string: the migrations path is absolute now, and
  // a checkout under a directory with a space in it would split in two
  const run = (args: readonly string[]) =>
    execFileSync('git', [...args], { cwd: migrations, encoding: 'utf8' }).trim()
  const diff = run(['diff', '--name-only', `${baseRef}...HEAD`, '--', migrations])
  // git prints repository-relative paths whatever the cwd is, so they are
  // resolved against the repository rather than against process.cwd(). Doing
  // it the other way round dropped every file the moment this ran from
  // anywhere but the repository root - and a guard that scans nothing reports
  // success, which is the one failure a destructive-SQL gate must not have.
  const root = run(['rev-parse', '--show-toplevel'])
  return (
    diff
      .split('\n')
      .filter((file) => file.endsWith('.sql'))
      .map((file) => path.resolve(root, file))
      // deletions are in the diff and have nothing left to scan
      .filter((file) => fs.existsSync(file))
  )
}
