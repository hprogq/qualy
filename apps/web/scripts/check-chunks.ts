import fs from 'node:fs'
import { collectWebPlugins } from '@qualy/web-build/collect'

// tree-shaking sentinel: every registered component must be an independent
// chunk in the web build; `--expect-absent <name>` additionally asserts a
// component was shaken away entirely. The keys come from the same collection
// the virtual module is built from - a release build carries the superset,
// so the sentinel reads it with `all` too.
// NOTE: relies on the bundler's default [name]-[hash] chunk naming;
// configuring manualChunks/chunkFileNames would silently break this.

const componentKeys = (await collectWebPlugins({ all: true })).flatMap((entry) =>
  Object.keys(entry.components),
)

const distDir = new URL('../dist/assets', import.meta.url).pathname
const files = fs.existsSync(distDir) ? fs.readdirSync(distDir) : []
const absentIndex = process.argv.indexOf('--expect-absent')
const expectAbsent = absentIndex >= 0 ? process.argv[absentIndex + 1] : undefined

// keys are namespaced "<plugin>/<Component>"; chunk files carry the
// component file's basename
const chunkName = (key: string) => key.split('/').pop()!

let failed = false
for (const name of componentKeys) {
  const present = files.some((file) => file.startsWith(`${chunkName(name)}-`))
  console.log(`${name}: ${present ? 'chunk present' : 'CHUNK MISSING'}`)
  if (!present) failed = true
}
if (expectAbsent) {
  if (componentKeys.includes(expectAbsent)) {
    console.log(`${expectAbsent}: still registered, regenerate first`)
    failed = true
  }
  const present = files.some((file) => file.startsWith(`${chunkName(expectAbsent)}-`))
  console.log(`${expectAbsent}: ${present ? 'UNEXPECTED CHUNK' : 'absent as expected'}`)
  if (present) failed = true
}
process.exit(failed ? 1 : 0)
