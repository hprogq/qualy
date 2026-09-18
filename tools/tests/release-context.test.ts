import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkoutOf, contextExcludes } from '../release/context.ts'

// What the release fingerprint is allowed to miss.
//
// Three images of one release are proven to come from one tree by taking
// this fingerprint before, between and after the builds and refusing the
// release if it moved. That proof is only as good as what the reading can
// see, and the thing it is easiest to miss is the gap between two ignore
// lists: `.gitignore` decides what git will tell you about, `.dockerignore`
// decides what docker reads, and they are not the same list. A generated
// file git never mentions still lands in `COPY . .`.
//
// So the subject here is a repository of the test's own, with a file in
// exactly that gap.

const made: string[] = []

const repo = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-release-context-')))
  made.push(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(root, '.gitignore'), 'generated/\n')
  // docker reads `generated/`; git does not mention it
  fs.writeFileSync(path.join(root, '.dockerignore'), 'node_modules\ndocs\n')
  fs.writeFileSync(path.join(root, 'app.ts'), 'export const a = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'first')
  return { root, git }
}

const write = (root: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}

afterEach(() => {
  for (const root of made.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('the fingerprint a release is proven by', () => {
  it('sees a file git ignores and docker reads', () => {
    const { root } = repo()
    const clean = checkoutOf(root)
    expect(clean.changed).toEqual([])

    // the shape of the gap: ignored by git, copied by docker
    write(root, 'generated/cache.ts', 'export const built = 1\n')
    const withFile = checkoutOf(root)
    expect(withFile.fingerprint).not.toBe(clean.fingerprint)
    expect(withFile.changed).toContain('generated/cache.ts')

    // and a build that reads it must not be called the same tree once it changes
    write(root, 'generated/cache.ts', 'export const built = 2\n')
    expect(checkoutOf(root).fingerprint).not.toBe(withFile.fingerprint)
  })

  it('leaves out what docker does not read, however loudly it changes', () => {
    const { root } = repo()
    const clean = checkoutOf(root)
    // notes and installed packages are not build inputs; a release is not
    // dirty because somebody is writing one
    write(root, 'docs/notes.md', 'thinking out loud\n')
    write(root, 'node_modules/left/index.js', 'module.exports = 1\n')
    expect(checkoutOf(root).fingerprint).toBe(clean.fingerprint)
    expect(checkoutOf(root).changed).toEqual([])
  })

  it('sees an ordinary tracked edit and an untracked source file', () => {
    const { root } = repo()
    const clean = checkoutOf(root)
    write(root, 'app.ts', 'export const a = 2\n')
    const edited = checkoutOf(root)
    expect(edited.fingerprint).not.toBe(clean.fingerprint)
    expect(edited.changed).toContain('app.ts')

    write(root, 'extra.ts', 'export const b = 1\n')
    const added = checkoutOf(root)
    expect(added.fingerprint).not.toBe(edited.fingerprint)
    expect(added.changed).toContain('extra.ts')
  })

  it('reads .dockerignore the way the build does', () => {
    const { root } = repo()
    const excluded = contextExcludes(root)
    expect(excluded('docs/notes.md')).toBe(true)
    expect(excluded('node_modules/left/index.js')).toBe(true)
    expect(excluded('app.ts')).toBe(false)
    expect(excluded('generated/cache.ts')).toBe(false)
  })
})
