import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Where the assembly's manifest is.
//
// Its own module, reachable without touching a generated one: the entry point
// needs the manifest before codegen has run, and `config.ts` imports the
// permission catalog, the login drivers and the ui surfaces - all of them
// derived from that same manifest, and none of them written yet at that point.
//
// Paths are anchored at this package rather than at the working directory, so
// the process behaves the same wherever it was started from.

const appRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * The manifest this process was started with, the same one main.ts verifies.
 *
 * Found by walking up from this package rather than named at a fixed depth,
 * because the two layouts put it in different places: in this repository it
 * sits at the root, beside the apps it configures, while a standalone
 * deployment has it next to the host and its node_modules. Walking up answers
 * both, and QUALY_CONFIG overrides it outright.
 */
export const manifestPath = (): string => {
  if (process.env.QUALY_CONFIG) return path.resolve(process.env.QUALY_CONFIG)
  let dir = appRoot
  for (;;) {
    const candidate = path.join(dir, 'qualy.yml')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(
        `no qualy.yml found in ${appRoot} or any directory above it; set QUALY_CONFIG to name one`,
      )
    }
    dir = parent
  }
}
