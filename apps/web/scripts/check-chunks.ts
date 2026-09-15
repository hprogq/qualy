import fs from 'node:fs'
import path from 'node:path'
import { collectWebPlugins } from '@qualy/web-build/collect'
import { BROWSER_SURFACE_MAP } from '@qualy/web-build/vite'
import { surfaceLabel } from '@qualy/ui-contract'

// Tree-shaking sentinel: every surface's renderer is an independent chunk in
// the web build, and `--expect-absent <surface>` asserts that one is not
// there at all.
//
// It reads the build's own private surface map rather than the file names.
// It used to count files whose basename matched the module's - which worked
// only while a public file was named after a source file, and that naming was
// itself the disclosure the build has since stopped making. Two plugins
// shipping a module of the same basename could also answer for each other,
// which is the regression this gate exists to catch, passing on a collision.
// The bundler writes down which chunk each surface landed in; this asserts
// the file is there.
//
// The map is a private build artifact and stays one: it never enters the
// release store, which `check-staged-web` holds.

interface SurfaceEntry {
  readonly owner: string
  readonly module: string
  readonly export: string
  readonly chunk?: string
}

const distDir = new URL('../dist', import.meta.url).pathname
const mapFile = path.join(distDir, BROWSER_SURFACE_MAP)
if (!fs.existsSync(mapFile)) {
  console.error(
    `check-chunks: no ${BROWSER_SURFACE_MAP} in apps/web/dist; run \`pnpm build\` first`,
  )
  process.exit(1)
}
const built = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as Record<string, SurfaceEntry>

let failed = false
for (const [surface, entry] of Object.entries(built)) {
  const present = entry.chunk !== undefined && fs.existsSync(path.join(distDir, entry.chunk))
  console.log(`${surface}: ${present ? 'chunk present' : 'CHUNK MISSING'}`)
  if (!present) failed = true
}

const absentIndex = process.argv.indexOf('--expect-absent')
const expectAbsent = absentIndex >= 0 ? process.argv[absentIndex + 1] : undefined
if (expectAbsent) {
  if (built[expectAbsent] !== undefined) {
    console.log(`${expectAbsent}: still built, disable its plugin first`)
    failed = true
  } else {
    // The module that WOULD have implemented it, read out of the INSTALLED
    // superset rather than guessed from the address. A surface nothing
    // installed declares is a typo, and saying so beats reporting it absent.
    const installed = (await collectWebPlugins({ all: true })).flatMap((entry) =>
      entry.surfaces.map((binding) => ({
        label: surfaceLabel(binding.surface),
        file: binding.file,
      })),
    )
    const gone = installed.find((one) => one.label === expectAbsent)
    if (gone === undefined) {
      console.log(`${expectAbsent}: no installed plugin declares this surface`)
      failed = true
    } else {
      // another built surface may legitimately share the module; then it is
      // in the build for that surface's sake and this one is still not built
      const shared = installed.some(
        (one) => one.file === gone.file && built[one.label] !== undefined,
      )
      console.log(`${expectAbsent}: ${shared ? 'UNEXPECTED CHUNK' : 'absent as expected'}`)
      if (shared) failed = true
    }
  }
}
process.exit(failed ? 1 : 0)
