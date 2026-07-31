import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEntries } from './read-entries.ts'

// schema aggregation reads the FULL cordis.yml entry list (disabled included):
// deactivating a plugin never changes the schema set, so tables outlive
// deactivation. Database capability is declared, never probed: a plugin
// without qualy.database.schemaEntry contributes nothing, a declared entry
// that fails to resolve is a hard error.

function resolvePackageDir(id: string): string {
  let entryUrl: string
  try {
    entryUrl = import.meta.resolve(id)
  } catch {
    throw new Error(`${id} cannot be resolved; is it missing from the root package.json?`)
  }
  let dir = path.dirname(fileURLToPath(entryUrl))
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`cannot locate package.json for ${id}`)
    dir = parent
  }
  return fs.realpathSync(dir)
}

export function resolveSchemaEntries(): string[] {
  const entries: string[] = []
  for (const entry of readEntries({ all: true })) {
    if (!entry.name.startsWith('@qualy/')) continue
    const packageDir = resolvePackageDir(entry.name)
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      qualy?: { database?: { schemaEntry?: string } }
    }
    const schemaEntry = pkg.qualy?.database?.schemaEntry
    if (!schemaEntry) continue
    const file = path.resolve(packageDir, schemaEntry)
    if (!fs.existsSync(file)) {
      throw new Error(`${entry.name}: declared schemaEntry ${schemaEntry} does not resolve to a file`)
    }
    entries.push(file)
  }
  return entries
}
