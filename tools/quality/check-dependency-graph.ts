import fs from 'node:fs'
import { lockedPackages, readLockfile } from '../lib/lockfile.ts'

// Whether GitHub's dependency graph still sees what this repository installs.
//
// Dependabot alerts come from that graph, and the graph comes from reading
// pnpm-lock.yaml on the default branch. When the reading goes wrong it goes
// wrong silently: with pnpm 12's two-document lockfile the graph kept 249 of
// 864 packages, every transitive dependency gone and no error anywhere
// (2026-09-29). tools/tests/lockfile.test.ts stops the known cause at commit
// time; this asks GitHub for the graph it actually built and holds it to the
// lockfile, so a cause nobody has met yet shows up too.
//
// Needs GITHUB_TOKEN (contents: read) and GITHUB_REPOSITORY (owner/name).
// The graph is rebuilt a few minutes after a push, so a package or two locked
// in the last minutes may be missing for a while: that is a warning, and only
// a graph missing a real share of the lockfile fails.

const MISSING_ALLOWED = 0.05

const token = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
if (!token || !repository) {
  console.error('check-dependency-graph: set GITHUB_TOKEN and GITHUB_REPOSITORY (owner/name)')
  process.exit(2)
}

const response = await fetch(`https://api.github.com/repos/${repository}/dependency-graph/sbom`, {
  headers: {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  },
})
if (!response.ok) {
  console.error(`check-dependency-graph: the SBOM request answered ${response.status}`)
  process.exit(1)
}
const { sbom } = (await response.json()) as {
  sbom: {
    creationInfo: { created: string }
    packages: { name: string; versionInfo?: string }[]
  }
}

const inGraph = new Set(sbom.packages.map((one) => `${one.name}@${one.versionInfo ?? ''}`))
const locked = lockedPackages(readLockfile()).map((one) => `${one.name}@${one.version}`)
const missing = locked.filter((key) => !inGraph.has(key))
const share = locked.length === 0 ? 1 : missing.length / locked.length

const lines = [
  `graph built ${sbom.creationInfo.created}: ${sbom.packages.length} packages`,
  `lockfile: ${locked.length} packages, ${missing.length} of them not in the graph`,
]
for (const line of lines) console.log(`check-dependency-graph: ${line}`)
const summary = process.env.GITHUB_STEP_SUMMARY
if (summary) {
  const listed = missing.slice(0, 50).map((key) => `- \`${key}\``)
  fs.appendFileSync(summary, ['### Dependency graph', '', ...lines, '', ...listed, ''].join('\n'))
}

if (locked.length === 0) {
  console.error('check-dependency-graph: no packages read from pnpm-lock.yaml')
  process.exit(1)
}
if (share > MISSING_ALLOWED) {
  console.error(
    `check-dependency-graph: the graph misses ${(share * 100).toFixed(0)}% of the lockfile; ` +
      'Dependabot is blind to those packages. Check how the lockfile is written ' +
      '(a second YAML document, a new lockfile version) before anything else.',
  )
  for (const key of missing.slice(0, 20)) console.error(`  ${key}`)
  process.exit(1)
}
for (const key of missing)
  console.log(`::warning::${key} is locked but not yet in the dependency graph`)
