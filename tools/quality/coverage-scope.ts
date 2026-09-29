import path from 'node:path'
import type { CoverageV8Options } from 'vitest/node'

// What a coverage figure for this repository is a fraction OF.
//
// Left to itself, V8 coverage counts only the files some test happened to
// load, so a module no test imports is not a gap in the report - it is
// absent from it, and the percentage flatters. The denominator is therefore
// named: the source of every host and every package the product is built
// from, whether or not anything loaded it. Test harnesses (testkit modules,
// packages/testkit) are not product and are left out; nothing else is, the
// hard-to-reach parts included - a figure that improves by dropping them
// would say less, not more.
//
// The node suite and the browser suite are measured against this same list,
// each counting what it ran; Codecov merges the two uploads. Code that only
// runs inside a child process or a container (the server host booted by a
// smoke, the sandboxes) stays in the denominator and is mostly uncounted:
// V8 sees the test process only. The figure means "reached by the node and
// Chromium suites", not "tested".
//
// Globs, not package names: which plugins exist is the assembly's business.

const SOURCES = [
  'apps/*/src/**/*.{ts,tsx}',
  'packages/core/*/src/**/*.{ts,tsx}',
  'packages/contracts/*/src/**/*.{ts,tsx}',
  'packages/web/*/src/**/*.{ts,tsx}',
  'packages/build/*/src/**/*.{ts,tsx}',
  'packages/plugins/*/*/src/**/*.{ts,tsx}',
]

const NOT_PRODUCT = ['**/*.d.ts', '**/testkit.ts', '**/testkit/**']

/**
 * The coverage settings both suites share, for a suite whose vite root is
 * `suiteRoot`. The globs are matched differently on either side of that
 * root, measured on vitest 5.0.1: inside it only a relative glob matches (an
 * absolute one counted nothing in the node suite, rooted at the repository),
 * and beyond it only an absolute one does (`../../packages/...` from the
 * browser suite's apps/web root counted five files instead of six hundred).
 */
export const coverageScope = (
  repoRoot: string,
  suiteRoot: string,
  reports: string,
): { provider: 'v8' } & CoverageV8Options => ({
  provider: 'v8',
  include: SOURCES.map((glob) =>
    path.resolve(suiteRoot) === path.resolve(repoRoot) ? glob : path.join(repoRoot, glob),
  ),
  exclude: NOT_PRODUCT,
  allowExternal: true,
  reportsDirectory: path.join(repoRoot, reports),
  // lcov paths relative to the repository, so the two uploads name one file
  // the same way whichever root the suite ran under
  reporter: [['text-summary'], ['json-summary'], ['lcov', { projectRoot: repoRoot }]],
})
