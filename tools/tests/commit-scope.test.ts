import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// A commit's scope is the one outward module the change mainly belongs to.
//
// A scope that lists every package a diff touched - `feat(auth,auth-local)`,
// `fix(assessment,iam,audit,settings,ui)` - stops saying where a change
// belongs and becomes a summary of the file list. A change across modules
// that is one capability takes its main module; one that belongs nowhere
// takes no scope; several unrelated changes are several commits. See the
// commit rules in CLAUDE.md.
//
// Checked from `SINCE` onward: the listed scopes after it were rewritten to
// one when the rule came in; the history before it is left as it was.

const root = fileURLToPath(new URL('../..', import.meta.url))

/** the last commit before the rewritten ones; everything after it is held to it */
const SINCE = '901d6a6624d20a2f0b132f2e9d5eb2639e75d084'

/** a type, then a scope that names more than one thing */
const LISTED_SCOPE = /^[a-z]+\([^)]*,[^)]*\)!?:/

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/** the subjects after the boundary, or undefined where this checkout cannot say */
const subjects = (): string[] | undefined => {
  try {
    git('cat-file', '-e', `${SINCE}^{commit}`)
    return git('log', '--format=%s', `${SINCE}..HEAD`)
      .split('\n')
      .filter((line) => line !== '')
  } catch {
    // no git, or a shallow clone without the boundary: nothing to read here;
    // CI checks out the whole history
    return undefined
  }
}

describe('commit subjects', () => {
  it('name one module as their scope, never a list of them', () => {
    const found = subjects()
    if (found === undefined) return
    expect(found.filter((subject) => LISTED_SCOPE.test(subject))).toEqual([])
  })

  it('would refuse a listed scope, and take one scope or none', () => {
    expect(LISTED_SCOPE.test('feat(auth,auth-local): sign in')).toBe(true)
    expect(LISTED_SCOPE.test('fix(ui, web)!: rule the rows apart')).toBe(true)
    expect(LISTED_SCOPE.test('feat(auth): sign in')).toBe(false)
    expect(LISTED_SCOPE.test('fix: align narrow tables')).toBe(false)
  })
})
