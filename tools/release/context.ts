import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// What a docker build would actually read, as one digest.
//
// Its own module because the invariant it carries is worth a test: three
// images of one release must be built from one tree, and the only evidence
// of that is this fingerprint taken before, between and after them. A
// fingerprint that cannot see part of the context would call two different
// contexts one tree, which is exactly the thing it exists to rule out - so
// the reading has to be exercised against a repository a test can build,
// rather than only against this one.

const git = (root: string, gitArgs: readonly string[]) =>
  execFileSync('git', [...gitArgs], { cwd: root, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 })

export interface Checkout {
  readonly commit: string
  /** the build inputs that differ from the commit, by path */
  readonly changed: readonly string[]
  readonly fingerprint: string
}

/**
 * Whether the build context leaves a path out, by the rules in .dockerignore.
 *
 * A change nothing builds from is not a change to the release: notes kept
 * untracked under docs/, a STATUS.md being written. Docker's reading, closely
 * enough for the patterns this repository writes: a pattern excludes what it
 * matches and everything under it, `!` puts a path back, the last rule that
 * matches decides.
 */
export const contextExcludes = (root: string) => {
  const rules = fs
    .readFileSync(path.join(root, '.dockerignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const negate = line.startsWith('!')
      const pattern = (negate ? line.slice(1) : line).replace(/^\/+/, '').replace(/\/+$/, '')
      return { negate, pattern }
    })
  return (file: string) => {
    const parts = file.split('/')
    const candidates = parts.map((_, at) => parts.slice(0, at + 1).join('/'))
    let excluded = false
    for (const rule of rules) {
      if (candidates.some((candidate) => path.matchesGlob(candidate, rule.pattern))) {
        excluded = !rule.negate
      }
    }
    return excluded
  }
}

const pathsOf = (output: Buffer) =>
  output
    .toString('utf8')
    .split('\0')
    .filter((name) => name !== '')

/** every file under a path docker would read, the ignore rules applied again */
const filesUnder = (
  root: string,
  excluded: (file: string) => boolean,
  name: string,
): readonly string[] => {
  const at = path.join(root, name)
  const stat = fs.statSync(at, { throwIfNoEntry: false })
  if (stat === undefined) return []
  if (!stat.isDirectory()) return [name]
  return fs
    .readdirSync(at)
    .map((entry) => `${name}/${entry}`)
    .filter((entry) => !excluded(entry))
    .sort()
    .flatMap((entry) => filesUnder(root, excluded, entry))
}

/**
 * The working directory as a build would read it, as one digest over the
 * inputs that differ from the commit.
 *
 * Three sets, because docker reads three: tracked changes with their content,
 * untracked files, and the files GIT ignores that docker does not. The last
 * one is easy to leave out and was: `.gitignore` and `.dockerignore` are not
 * the same list, so a generated file git never mentions still lands in
 * `COPY . .` - and a fingerprint that could not see it would call two
 * different contexts one tree, which is the whole thing this digest exists
 * to rule out. Ignored directories are asked for whole (`--directory`) and
 * then filtered, so the common case - node_modules, which docker excludes -
 * costs one path rather than a walk.
 *
 * A named release does not rely on any of this: it builds from a detached
 * worktree of the commit, where none of these files exist at all.
 */
export const checkoutOf = (root: string): Checkout => {
  const excluded = contextExcludes(root)
  const commit = git(root, ['rev-parse', 'HEAD']).toString('utf8').trim()
  const digest = createHash('sha256').update(commit)
  const tracked = pathsOf(git(root, ['diff', 'HEAD', '--name-only', '-z']))
    .filter((name) => !excluded(name))
    .sort()
  if (tracked.length > 0) digest.update(git(root, ['diff', 'HEAD', '--binary', '--', ...tracked]))
  const loose = [
    ...pathsOf(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
    ...pathsOf(
      git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']),
    ).map((name) => name.replace(/\/$/, '')),
  ]
    .filter((name) => !excluded(name))
    .sort()
    .flatMap((name) => filesUnder(root, excluded, name))
  for (const name of loose) {
    digest.update(`\0${name}\0`)
    const at = path.join(root, name)
    if (fs.statSync(at, { throwIfNoEntry: false })?.isFile()) digest.update(fs.readFileSync(at))
  }
  return { commit, changed: [...tracked, ...loose], fingerprint: digest.digest('hex') }
}
