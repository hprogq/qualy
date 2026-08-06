import { collectReport } from './lib/report.ts'

// single generator entry: every generator runs in this process and reads the
// same argv, so `--all` reaches all of them. Chaining them in a package.json
// script would not work, pnpm appends passthrough args only to the tail
// command of the chain.

export async function generateAll(): Promise<void> {
  // The server assembles at boot from descriptors; what is still generated
  // is what only exists at build time - the browser's typed client aggregate
  // and its chunk registry. Side-effecting modules, and imports are cached:
  // this runs them once per process, which is what both callers want.
  await import('./gen-api.ts')
  await import('./gen-plugins.ts')
}

/** the same run, with what it wrote returned instead of printed */
export const generateAllQuietly = (): Promise<string[]> => collectReport(generateAll)

// run directly by `pnpm gen` and by every script that prefixes it
if (import.meta.url === `file://${process.argv[1]}`) {
  await generateAll()
}
