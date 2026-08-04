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

export function scanDestructive(files: readonly string[]): string[] {
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
    .readdirSync(migrations, { recursive: true })
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => path.join(migrations, entry))
    .filter((file) => path.basename(file) === 'migration.sql')
}

/** migrations added or changed since a git ref */
export function changedMigrationFiles(migrations: string, baseRef: string): string[] {
  // argv rather than a shell string: the migrations path is absolute now, and
  // a checkout under a directory with a space in it would split in two
  const diff = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`, '--', migrations], {
    encoding: 'utf8',
  })
  return diff
    .split('\n')
    .filter((file) => file.endsWith('.sql'))
    .filter((file) => fs.existsSync(file))
}
