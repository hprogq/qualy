import fs from 'node:fs'
import YAML from 'yaml'

// cordis.yml describes the ACTIVE set only (what runs); anything derived from
// the installed set (database schema, migrations) must go through
// scripts/lib/installed.ts instead and never read this file.

export interface Entry {
  id?: string
  name: string
  config?: unknown
  disabled?: boolean
}

// pass { all: true } (or run with --all) to include disabled entries,
// release builds aggregate the full superset this way
export function readEntries(options: { all?: boolean } = {}): Entry[] {
  const all = options.all ?? process.argv.includes('--all')
  const raw = YAML.parse(fs.readFileSync('cordis.yml', 'utf8'))
  if (!Array.isArray(raw)) throw new Error('cordis.yml must be a top-level array of entries')

  const flatten = (entries: Entry[]): Entry[] =>
    entries.flatMap((entry) => {
      if (!all && entry.disabled) return []
      if (entry.name === 'loader:group') return flatten((entry.config as Entry[]) ?? [])
      return [entry]
    })

  return flatten(raw as Entry[])
}
