import { buildAssembly, writeAssemblyLock } from './lib/assembly.ts'
import { writeGenerated } from './lib/codegen.ts'

// aggregation is driven exclusively by installed.lock.json: deactivating a
// plugin in cordis.yml must never change this output, so tables outlive
// deactivation. Removing a plugin from the installed set (explicit purge
// flow) is the only way to end up with a DROP migration.

const initEmpty = process.argv.includes('--init-empty')

const assembly = buildAssembly()

if (assembly.plugins.length === 0 && !initEmpty) {
  throw new Error(
    'the installed set contributes no database schema; pass --init-empty if this is intentional',
  )
}

const body = [
  'export const schemaEntries: string[] = [',
  ...assembly.schemaEntries.map((entry) => `  '${entry}',`),
  ']',
].join('\n')

writeGenerated('generated/db/assembly.gen.ts', body, { source: 'installed.lock.json' })
writeAssemblyLock(assembly)
