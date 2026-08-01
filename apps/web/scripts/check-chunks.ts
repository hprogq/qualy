import fs from 'node:fs'
import { components } from '../src/plugins.gen.ts'

// tree-shaking sentinel: every registered component must be an independent
// chunk in the web build; `--expect-absent <name>` additionally asserts a
// component was shaken away entirely.
// NOTE: relies on the bundler's default [name]-[hash] chunk naming;
// configuring manualChunks/chunkFileNames would silently break this.

const distDir = new URL('../dist/assets', import.meta.url).pathname
const files = fs.existsSync(distDir) ? fs.readdirSync(distDir) : []
const absentIndex = process.argv.indexOf('--expect-absent')
const expectAbsent = absentIndex >= 0 ? process.argv[absentIndex + 1] : undefined

let failed = false
for (const name of Object.keys(components)) {
  const present = files.some((file) => file.startsWith(`${name}-`))
  console.log(`${name}: ${present ? 'chunk present' : 'CHUNK MISSING'}`)
  if (!present) failed = true
}
if (expectAbsent) {
  if (expectAbsent in components) {
    console.log(`${expectAbsent}: still registered, regenerate first`)
    failed = true
  }
  const present = files.some((file) => file.startsWith(`${expectAbsent}-`))
  console.log(`${expectAbsent}: ${present ? 'UNEXPECTED CHUNK' : 'absent as expected'}`)
  if (present) failed = true
}
process.exit(failed ? 1 : 0)
