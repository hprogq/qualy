import { compileMessages, type OutputStructure } from './messages.ts'

// `pnpm i18n`: compiles every package's messages and writes each package's
// #messages facade. Run by the gates that read the facades (typecheck, the
// test runners, the type-aware lint) and by the dev server and the build,
// which pick the module layout; a run whose inputs have not changed writes
// nothing.

const structure: OutputStructure | undefined = process.argv.includes('--dev')
  ? 'locale-modules'
  : process.argv.includes('--build')
    ? 'message-modules'
    : undefined
const started = performance.now()
const result = await compileMessages({
  ...(structure === undefined ? {} : { outputStructure: structure }),
  force: process.argv.includes('--force'),
})
const seconds = ((performance.now() - started) / 1000).toFixed(1)
console.log(
  result.compiled
    ? `messages: ${result.messages} compiled from ${result.sources.length} packages (${seconds}s)`
    : `messages: ${result.messages} unchanged`,
)
