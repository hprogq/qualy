import path from 'node:path'
import { writeGenerated } from './lib/codegen.ts'
import { loadInstalled } from './lib/installed.ts'

// aggregation is driven exclusively by installed.lock.json: deactivating a
// plugin in cordis.yml must never change this output, so tables outlive
// deactivation. Removing a plugin from the installed set (explicit purge
// flow) is the only way to end up with a DROP migration.

const initEmpty = process.argv.includes('--init-empty')

const plugins = loadInstalled().filter((plugin) => plugin.database)

if (plugins.length === 0 && !initEmpty) {
  throw new Error(
    'the installed set contributes no database schema; pass --init-empty if this is intentional',
  )
}

const lines = plugins.map((plugin) => {
  const relative = path.relative('db', plugin.database!.schemaEntryFile).split(path.sep).join('/')
  return `export * from '${relative}'`
})
if (lines.length === 0) lines.push('export {}')

writeGenerated('db/schema.gen.ts', lines.join('\n'), { source: 'installed.lock.json' })
