import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from './manifest.ts'

// The lockfile as the tools outside pnpm read it. Parsed by hand, not with a
// YAML library, so a check can run on a checkout without installing anything;
// tools/tests/lockfile.test.ts holds this reading to what a YAML parser sees.

export const LOCKFILE = path.join(repoRoot, 'pnpm-lock.yaml')

export const readLockfile = (file: string = LOCKFILE): string => fs.readFileSync(file, 'utf8')

/**
 * How many YAML documents the file holds. A `---` line opens a document; a
 * file without one is a single document.
 */
export const documentCount = (text: string): number => {
  const markers = text.split('\n').filter((line) => line.trimEnd() === '---').length
  return text.startsWith('---') ? markers : markers + 1
}

export interface LockedPackage {
  readonly name: string
  readonly version: string
}

/** every entry of the `packages:` section, as `name@version` splits it */
export const lockedPackages = (text: string): LockedPackage[] => {
  const lines = text.split('\n')
  const start = lines.indexOf('packages:')
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
