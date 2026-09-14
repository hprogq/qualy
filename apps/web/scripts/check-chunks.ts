import fs from 'node:fs'
import { collectWebPlugins } from '@qualy/web-build/collect'
import { surfaceLabel } from '@qualy/ui-contract'

// tree-shaking sentinel: every surface's renderer must be an independent
// chunk in the web build; `--expect-absent <surface>` additionally asserts a
// renderer was shaken away entirely. The surfaces come from the same
// collection the virtual module is built from - a release build carries the
// superset, so the sentinel reads it with `all` too.
// NOTE: relies on the bundler's default [name]-[hash] chunk naming;
// configuring manualChunks/chunkFileNames would silently break this.

// A chunk is named after the MODULE, and a surface is named after the
// product, so the two are related only through the binding the collector
// resolved. Reading the basename out of a surface address was possible while
// an address was `<plugin>/<SourceFile>`, and would now look for a chunk
// called `batches`.
const bindings = (await collectWebPlugins({ all: true })).flatMap((entry) => entry.surfaces)
const surfaces = bindings.map((binding) => surfaceLabel(binding.surface))

const distDir = new URL('../dist/assets', import.meta.url).pathname
const files = fs.existsSync(distDir) ? fs.readdirSync(distDir) : []
const absentIndex = process.argv.indexOf('--expect-absent')
const expectAbsent = absentIndex >= 0 ? process.argv[absentIndex + 1] : undefined

// Two plugins may legally ship a module of the same basename, and chunk files
// carry only that basename. Asking whether ONE chunk starts with it therefore
// let a sibling plugin's chunk answer for a module that had lost its own -
// the regression this gate exists to catch, passing because of a name
// collision. Counting per basename does not. Two surfaces sharing one module
// share its chunk, so a module is counted once however many surfaces name it.
const chunkName = (file: string) =>
  file
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')
const chunksNamed = (base: string) => files.filter((file) => file.startsWith(`${base}-`)).length

const modulesOf = (base: string) =>
  new Set(bindings.filter((binding) => chunkName(binding.file) === base).map((b) => b.file)).size

const expected = new Map<string, string[]>()
for (const binding of bindings) {
  const base = chunkName(binding.file)
  expected.set(base, [...(expected.get(base) ?? []), surfaceLabel(binding.surface)])
}

let failed = false
for (const [base, named] of expected) {
  const wanted = modulesOf(base)
  const found = chunksNamed(base)
  const enough = found >= wanted
  const shown = named.length > 1 ? `${named.join(', ')} (${found}/${wanted} chunks)` : named[0]!
  console.log(`${shown}: ${enough ? 'chunk present' : 'CHUNK MISSING'}`)
  if (!enough) failed = true
}
if (expectAbsent) {
  if (surfaces.includes(expectAbsent)) {
    console.log(`${expectAbsent}: still registered, regenerate first`)
    failed = true
  }
  // absent means no chunk of its own: what is left is exactly what the
  // modules still bound to a surface under that basename account for
  const gone = bindings.find((binding) => surfaceLabel(binding.surface) === expectAbsent)
  const base = gone === undefined ? expectAbsent.split(':').pop()! : chunkName(gone.file)
  const found = chunksNamed(base)
  const others = modulesOf(base)
  console.log(`${expectAbsent}: ${found > others ? 'UNEXPECTED CHUNK' : 'absent as expected'}`)
  if (found > others) failed = true
}
process.exit(failed ? 1 : 0)
