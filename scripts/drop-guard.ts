import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// destructive statements never leave a generator silently: a migration that
// drops tables or columns requires ALLOW_DESTRUCTIVE=1 at generation time,
// or an explicit '-- destructive: approved' marker for reviewed purge
// migrations already in the lineage.

const destructivePatterns = [/\bdrop\s+table\b/i, /\bdrop\s+column\b/i]
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

function allMigrationFiles(): string[] {
  const root = 'db/migrations'
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root)
    .map((folder) => path.join(root, folder, 'migration.sql'))
    .filter((file) => fs.existsSync(file))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const hits = scanDestructive(files.length > 0 ? files : allMigrationFiles())
  if (hits.length > 0 && process.env.ALLOW_DESTRUCTIVE !== '1') {
    console.error('drop-guard: destructive statements detected')
    for (const hit of hits) console.error(`  ${hit}`)
    process.exit(1)
  }
  console.log('drop-guard: ok')
}
