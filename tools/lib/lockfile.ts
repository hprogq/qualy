import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from './manifest.ts'

// The lockfile as the tools outside pnpm read it. Parsed by hand, not with a
// YAML library, so a check can run on a checkout without installing anything;
// tools/tests/lockfile.test.ts holds this reading to what a YAML parser sees.

export const LOCKFILE = path.join(repoRoot, 'pnpm-lock.yaml')

export const readLockfile = (file: string = LOCKFILE): string => fs.readFileSync(file, 'utf8')

export interface LockedPackage {
  readonly name: string
  readonly version: string
}

/**
 * Application packages, as `name@version` splits them. pnpm 12 puts its
 * toolchain in a separate document before the workspace dependency graph.
 * The GitHub comparison measures that graph, not the pnpm executable.
 */
export const lockedPackages = (text: string): LockedPackage[] => {
  const lines = text.split('\n')
  const document = lines.findLastIndex((line) => line.trimEnd() === '---')
  const start = lines.findIndex((line, at) => at > document && line === 'packages:')
  if (start < 0) return []
  const found: LockedPackage[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const key = /^ {2}'?([^\s'].*?)'?:$/.exec(line)?.[1]
    if (key === undefined) continue
    const at = key.lastIndexOf('@')
    if (at <= 0) continue
    found.push({ name: key.slice(0, at), version: key.slice(at + 1) })
  }
  return found
}
