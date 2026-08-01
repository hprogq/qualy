import fs from 'node:fs'
import YAML from 'yaml'

// qualy.yml describes the ACTIVE set (what runs); schema aggregation goes
// through scripts/lib/schema-entries.ts, which reads this file with all: true
// so that disabled entries still contribute their tables.

export interface Entry {
  id?: string
  name: string
  config?: unknown
  disabled?: boolean
}

// pass { all: true } (or run with --all) to include disabled entries,
// release builds aggregate the full superset this way
export function readEntries(options: { all?: boolean; ymlPath?: string } = {}): Entry[] {
  const all = options.all ?? process.argv.includes('--all')
  const ymlPath = options.ymlPath ?? 'packages/app/qualy.yml'
  const raw = YAML.parse(fs.readFileSync(ymlPath, 'utf8'))
  if (!Array.isArray(raw)) throw new Error(`${ymlPath} must be a top-level array of entries`)

  const flatten = (entries: Entry[]): Entry[] =>
    entries.flatMap((entry) => {
      if (!all && entry.disabled) return []
      if (entry.name === 'loader:group') return flatten((entry.config as Entry[]) ?? [])
      return [entry]
    })

  return flatten(raw as Entry[])
}
