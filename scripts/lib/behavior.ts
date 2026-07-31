import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ResolvedPlugin } from './installed.ts'

// behavior fragments are the plugin-owned home for hand-written SQL
// (functions, triggers, views): numbered, append-only files compiled into
// the central migration lineage by db:gen. A registered fragment may never
// change or disappear; follow-up work is always a new fragment.

export type FragmentPhase = 'pre-structure' | 'post-structure' | 'manual'

export interface Fragment {
  plugin: string
  pluginVersion: string
  file: string
  rel: string
  key: string
  seq: string
  phase: FragmentPhase
  sha256: string
  sql: string
}

export interface BehaviorLock {
  fragments: Record<string, { sha256: string; migration: string }>
}

const lockFile = 'behavior.lock.json'
const namePattern = /^(\d{4})_[a-z0-9_]+\.sql$/
const phasePattern = /^--\s*phase:\s*(pre-structure|post-structure|manual)\s*$/m

export function readBehaviorLock(): BehaviorLock {
  if (!fs.existsSync(lockFile)) return { fragments: {} }
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as BehaviorLock
  if (typeof lock.fragments !== 'object' || lock.fragments === null) {
    throw new Error(`${lockFile} is malformed: expected a top-level "fragments" object`)
  }
  return lock
}

export function writeBehaviorLock(lock: BehaviorLock): void {
  const sorted = Object.fromEntries(
    Object.entries(lock.fragments).sort(([a], [b]) => a.localeCompare(b)),
  )
  fs.writeFileSync(lockFile, JSON.stringify({ fragments: sorted }, null, 2) + '\n')
}

export function collectFragments(resolved: ResolvedPlugin[]): Fragment[] {
  const fragments: Fragment[] = []
  for (const plugin of resolved) {
    const dir = plugin.database?.behaviorDirPath
    if (!dir || !fs.existsSync(dir)) continue
    const files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .sort()
    for (const file of files) {
      const match = namePattern.exec(file)
      if (!match) {
        throw new Error(`${plugin.id}: behavior fragment ${file} must be named NNNN_name.sql`)
      }
      const fullPath = path.join(dir, file)
      const sql = fs.readFileSync(fullPath, 'utf8')
      fragments.push({
        plugin: plugin.id,
        pluginVersion: plugin.packageVersion,
        file: fullPath,
        rel: `${plugin.database!.behaviorDir}/${file}`,
        key: `${plugin.id}/${file}`,
        seq: match[1]!,
        phase: (phasePattern.exec(sql)?.[1] as FragmentPhase) ?? 'post-structure',
        sha256: crypto.createHash('sha256').update(sql).digest('hex'),
        sql,
      })
    }
  }
  return fragments
}

// registered fragments are immutable: any change or disappearance fails the
// build, only additions come back as fresh work
export function validateAgainstLock(fragments: Fragment[], lock: BehaviorLock): Fragment[] {
  const present = new Map(fragments.map((fragment) => [fragment.key, fragment]))
  for (const [key, entry] of Object.entries(lock.fragments)) {
    const fragment = present.get(key)
    if (!fragment) {
      throw new Error(`registered behavior fragment ${key} has disappeared; fragments are append-only`)
    }
    if (fragment.sha256 !== entry.sha256) {
      throw new Error(`registered behavior fragment ${key} was modified; fragments are immutable`)
    }
  }
  return fragments.filter((fragment) => !lock.fragments[fragment.key])
}
