import fs from 'node:fs'
import { CliRefused, type CliContext } from '@qualy/plugin-kit/cli'
import { bundleEdgeFunction } from '../dev/edge-bundle.ts'

// `qualy cos edge-build [--out <file>]` - the EdgeOne delivery function as
// the platform takes it: one script, written to a file or to standard
// output. What goes to the platform is exactly this; the settings it reads
// (FILES_ORIGIN, APP_ORIGIN, ISSUER, VERIFY_KEYS, QUALY_EDGE_KEY) are the
// function's environment, configured beside it, and none of them is in the
// script.

const valueOf = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  if (at === -1) return undefined
  const value = args[at + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new CliRefused(`--${name} needs a value`)
  }
  return value
}

export async function run(context: CliContext): Promise<void> {
  const out = valueOf(context.args, 'out')
  const script = await bundleEdgeFunction().catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new CliRefused(
        'edge-build requires a source checkout with development dependencies installed',
      )
    }
    throw error
  })
  if (out === undefined) {
    process.stdout.write(script)
    return
  }
  fs.writeFileSync(out, script)
  console.log(`cos: edge function written to ${out} (${script.length} characters)`)
}
