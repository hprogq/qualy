import fs from 'node:fs'
import YAML from 'yaml'

export interface Entry {
  id?: string
  name: string
  config?: unknown
  disabled?: boolean
}

// pass { all: true } (or run with --all) to aggregate the full superset,
// including disabled entries; release builds rely on this mode
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

// false means either "package has no such subpath" (expected, silent) or
// "package cannot be resolved at all", which usually indicates a missing
// workspace dependency in the root package.json and deserves a warning
export function hasExport(name: string, subpath: string): boolean {
  try {
    import.meta.resolve(`${name}/${subpath}`)
    return true
  } catch {
    try {
      import.meta.resolve(name)
    } catch {
      console.warn(`warning: ${name} cannot be resolved, is it missing from the root package.json?`)
    }
    return false
  }
}
