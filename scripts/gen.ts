import { collectReport } from './lib/report.ts'

// One generator is left: the browser's typed client aggregate, which is a
// build-time type and cannot be virtual across a package boundary. The chunk
// registry became `virtual:qualy/plugins`, served by the Vite plugin in
// apps/web/vite.config.ts - the frontend toolchain owns every frontend
// artifact, and the server generates nothing.

export async function generateAll(): Promise<void> {
  // a side-effecting module, and imports are cached: this runs once per
  // process, which is what both callers want
  await import('./gen-api.ts')
}

/** the same run, with what it wrote returned instead of printed */
export const generateAllQuietly = (): Promise<string[]> => collectReport(generateAll)

// run directly by `pnpm gen` and by every script that prefixes it
if (import.meta.url === `file://${process.argv[1]}`) {
  await generateAll()
}
