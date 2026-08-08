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

// Keys are namespaced "<plugin>/<Component>" and two plugins may legally ship
// the same basename; chunk files carry only that basename. Asking whether ONE
// chunk starts with it therefore let a sibling plugin's chunk answer for a
// component that had lost its own - the regression this gate exists to catch,
// passing because of a name collision. Counting per basename does not.
const chunkName = (key: string) => key.split('/').pop()!
const chunksNamed = (base: string) => files.filter((file) => file.startsWith(`${base}-`)).length

const expected = new Map<string, string[]>()
for (const key of componentKeys) {
  const base = chunkName(key)
  expected.set(base, [...(expected.get(base) ?? []), key])
}

let failed = false
for (const [base, keys] of expected) {
  const found = chunksNamed(base)
  const enough = found >= keys.length
  const shown = keys.length > 1 ? `${keys.join(', ')} (${found}/${keys.length} chunks)` : keys[0]!
  console.log(`${shown}: ${enough ? 'chunk present' : 'CHUNK MISSING'}`)
  if (!enough) failed = true
}
if (expectAbsent) {
  if (componentKeys.includes(expectAbsent)) {
    console.log(`${expectAbsent}: still registered, regenerate first`)
    failed = true
  }
  // absent means no chunk of its own: what is left is exactly what the
  // components still registered under that basename account for
  const base = chunkName(expectAbsent)
  const found = chunksNamed(base)
  const others = expected.get(base)?.length ?? 0
  console.log(`${expectAbsent}: ${found > others ? 'UNEXPECTED CHUNK' : 'absent as expected'}`)
  if (found > others) failed = true
}
process.exit(failed ? 1 : 0)
