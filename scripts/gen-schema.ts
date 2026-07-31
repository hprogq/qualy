import { buildAssembly, writeAssemblyArtifacts } from './lib/assembly.ts'

// aggregation is driven exclusively by installed.lock.json: deactivating a
// plugin in cordis.yml must never change this output, so tables outlive
// deactivation. Removing a plugin from the installed set (explicit purge
// flow) is the only way to end up with a DROP migration.

writeAssemblyArtifacts(buildAssembly(), { initEmpty: process.argv.includes('--init-empty') })
