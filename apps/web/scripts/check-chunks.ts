import fs from 'node:fs'
import { collectWebPlugins } from '@qualy/web-build/collect'
import { surfaceLabel } from '@qualy/ui-contract'

// Tree-shaking sentinel: every surface's renderer is an independent chunk in
// the web build, and `--expect-absent <surface>` asserts that one is not
// there at all.
//
// Both halves read the same two collections and never guess. The ACTIVE set
// is what the build carries, so it is what the positive half expects; the
// SUPERSET is only how a surface that is deliberately not built is looked up
// - a disabled plugin has no binding in the active set, and the question
// "which module would have implemented it" has no other answer. Deriving a
// chunk name from a surface address was possible while an address WAS the
// source file (`assessment/ReviewPage`); it would now look for a chunk called
// `batches`.
//
// NOTE: relies on the bundler's default [name]-[hash] chunk naming;
// configuring manualChunks/chunkFileNames would silently break this.

const bindingsOf = async (all: boolean) =>
  (await collectWebPlugins(all ? { all: true } : {})).flatMap((entry) => entry.surfaces)

const built = await bindingsOf(false)
const installed = await bindingsOf(true)
const surfaces = new Set(built.map((binding) => surfaceLabel(binding.surface)))

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

/** how many distinct modules the BUILT set puts under one chunk basename */
const modulesOf = (base: string) =>
  new Set(built.filter((binding) => chunkName(binding.file) === base).map((b) => b.file)).size

const expected = new Map<string, string[]>()
for (const binding of built) {
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
  if (surfaces.has(expectAbsent)) {
    console.log(`${expectAbsent}: still built, disable its plugin first`)
    failed = true
  }
  // The module that WOULD have implemented it, read out of the installed
  // set rather than guessed from the address. A surface nothing installed
  // declares is a typo, and saying so beats reporting it absent.
  const gone = installed.find((binding) => surfaceLabel(binding.surface) === expectAbsent)
  if (gone === undefined) {
    console.log(`${expectAbsent}: no installed plugin declares this surface`)
    failed = true
  } else {
    const base = chunkName(gone.file)
    const found = chunksNamed(base)
    const others = modulesOf(base)
    console.log(`${expectAbsent}: ${found > others ? 'UNEXPECTED CHUNK' : 'absent as expected'}`)
    if (found > others) failed = true
  }
}
process.exit(failed ? 1 : 0)
