/**
 * The identities frozen into every published version. The compiler reports
 * itself (patch suffix included: 7.0.2+effect-tsgo.x is the truth of what
 * checked the source); esbuild exports its version; the ABI number comes
 * from the SDK; the engine identity from the sandbox. Cached per process —
 * none of these change without a deploy.
 */

import { execFile } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { version as esbuildVersion } from 'esbuild'

const here = createRequire(import.meta.url)

/** typescript's exports hide bin/; the version module is the resolvable hop */
export const tscEntry = path.join(path.dirname(here.resolve('typescript')), '..', 'bin', 'tsc')

let compiler: Promise<string> | undefined

export const typescriptVersion = (): Promise<string> => {
  compiler ??= new Promise((resolve, reject) => {
    execFile(process.execPath, [tscEntry, '--version'], { timeout: 30_000 }, (error, stdout) => {
      if (error) return reject(error)
      const match = /Version (\S+)/.exec(stdout)
      resolve(match?.[1] ?? stdout.trim())
    })
  })
  return compiler
}

export { esbuildVersion }
