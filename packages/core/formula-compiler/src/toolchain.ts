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
import { pathToFileURL } from 'node:url'
import { version as esbuildVersion } from 'esbuild'

const here = createRequire(import.meta.url)

/** typescript's exports hide bin/ and lib/; the version module is the resolvable hop */
const typescriptRoot = path.join(path.dirname(here.resolve('typescript')), '..')

/**
 * The native compiler, found the way the package's `tsc` entry finds it - by
 * the package's own lookup, so a platform package or a patched binary is the
 * same file either way. That entry is a node script that only looks the
 * binary up and becomes it; spawned directly, a check no longer starts a
 * node process first, which was about half of every typecheck (56 ms
 * through the entry, 25 ms direct, measured locally).
 */
export const tscExecutable: string = (
  (await import(pathToFileURL(path.join(typescriptRoot, 'lib', 'getExePath.js')).href)) as {
    readonly default: () => string
  }
).default()

let compiler: Promise<string> | undefined

export const typescriptVersion = (): Promise<string> => {
  compiler ??= new Promise((resolve, reject) => {
    execFile(tscExecutable, ['--version'], { timeout: 30_000 }, (error, stdout) => {
      if (error) return reject(error)
      const match = /Version (\S+)/.exec(stdout)
      resolve(match?.[1] ?? stdout.trim())
    })
  })
  return compiler
}

export { esbuildVersion }
