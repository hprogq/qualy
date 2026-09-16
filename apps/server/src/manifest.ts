import { fileURLToPath } from 'node:url'
import { locateManifest } from '@qualy/assembly'

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
 * The one discovery rule every entry point shares (`locateManifest`):
 * QUALY_CONFIG names it outright, otherwise the nearest qualy.yml walking up -
 * from this package rather than from a fixed depth, because the two layouts
 * put it in different places: in this repository it sits at the root, beside
 * the apps it configures, while a standalone product has it beside the
 * node_modules this package was installed into.
 */
export const manifestPath = (): string => locateManifest({ env: process.env, from: appRoot })
