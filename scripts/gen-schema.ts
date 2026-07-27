import { writeGenerated } from './lib/codegen.ts'
import { hasExport, readEntries } from './lib/read-entries.ts'

const all = process.argv.includes('--all')

const lines: string[] = []
for (const entry of readEntries({ all })) {
  if (!entry.name.startsWith('@qualy/')) continue
  if (hasExport(entry.name, 'schema')) {
    lines.push(`export * from '${entry.name}/schema'`)
  }
}

if (lines.length === 0) {
  console.warn('warning: no plugin exposes a ./schema export, emitting an empty schema')
  lines.push('export {}')
}

writeGenerated('db/schema.gen.ts', lines.join('\n'))
