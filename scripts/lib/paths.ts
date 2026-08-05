import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Where generated artifacts live.
//
// Anchored at this file rather than at the working directory, because every
// artifact is reached by a static import: the host imports runtime.gen.ts by
// relative path, so the generator cannot decide to put it elsewhere. `--yml`
// chooses which selection is generated, never where it lands.
export const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

/**
 * The tree generated files are written into.
 *
 * Always the repository for a real run. A test that generates a DIFFERENT
 * selection points it at a throwaway directory instead, because the suite runs
 * files in parallel: generating into the working tree meant one test rewrote
 * the artifacts another was in the middle of reading, and the failure surfaced
 * as an unrelated suite losing routes. Passing the root explicitly is what
 * makes those runs independent rather than merely unlikely to collide.
 */
export const outputRoot = (): string => process.env.QUALY_GEN_OUT ?? repoRoot

/** a generated artifact's absolute path, given its repository-relative one */
export const generatedPath = (relative: string): string => path.resolve(outputRoot(), relative)

export const RUNTIME_MODULE = 'apps/server/runtime.gen.ts'
