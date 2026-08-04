import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Who is allowed to own a database connection.
//
// Six business plugin suites had each reimplemented the same postgres
// bootstrap: probe, create a scratch database, run the migration lineage by
// hand, then start the database plugin with migrations turned off. Two owners
// of one database, the plugin's real lifecycle never exercised, and pool
// errors silenced so that dropping a database out from under live connections
// looked clean. Documenting the rule was not going to stop the seventh copy.
//
// The rule is not "tests may not run sql". A constraint only earns its place
// if it refuses what a service would never send, so schema suites must be
// able to write illegal rows directly. The rule is that only the plugin whose
// domain is the database owns the driver, the connection string, database
// creation, migration execution and teardown.

const walk = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full)
        return /\.tsx?$/.test(entry.name) ? [full] : []
      })
    : []

const posix = (file: string) => file.split(path.sep).join('/')

const walkManifests = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkManifests(full)
        return entry.name === 'package.json' ? [full] : []
      })
    : []

// Found by shape rather than by one directory name, so moving a suite into
// src/, __tests__/ or spec/ does not walk it out of the rule.
const isTestFile = (file: string) =>
  /(?:^|\/)(?:tests|__tests__|spec)\//.test(posix(file)) ||
  /\.(?:test|spec)\.[cm]?tsx?$/.test(file)

const OWNS_CONNECTIONS = 'packages/plugins/infra/database'

// The scripts whose public interface is a PoolClient, named to the file. A
// directory-wide exemption would quietly cover whatever is added next to
// them.
const SCRIPTS_MAY_CONNECT = new Set([
  'scripts/seed.ts',
  'scripts/db-migrate.ts',
  'scripts/lib/seed.ts',
  'scripts/tests/seed.test.ts',
  // this file states the patterns, so it contains all of them
  'scripts/tests/test-layers.test.ts',
])

// Pinned to the file, because these are the suites the rule was written for.
// Deleting, moving or renaming one has to be a decision the diff shows.
const MIGRATED_SUITES = [
  'packages/plugins/base/auth/tests/schema.test.ts',
  'packages/plugins/base/auth/tests/iam.test.ts',
  'packages/plugins/base/auth-local/tests/local-login.test.ts',
  'packages/plugins/base/org/tests/schema.test.ts',
  'packages/plugins/base/org/tests/org.test.ts',
  'packages/plugins/base/rbac/tests/rbac.test.ts',
]

const OWNERSHIP: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /from ['"]pg['"]/, why: 'imports the postgres driver' },
  { pattern: /new Pool\(/, why: 'constructs its own connection pool' },
  { pattern: /plugin-database\/migrator/, why: 'runs the migration lineage itself' },
  { pattern: /process\.env\.DATABASE_URL/, why: 'reads the connection string' },
  { pattern: /QUALY_REQUIRE_POSTGRES_TESTS/, why: 'reimplements the availability policy' },
  { pattern: /create database|drop database/i, why: 'manages database lifetime' },
]

const breaches = (files: readonly string[], rules: readonly { pattern: RegExp; why: string }[]) =>
  files.flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        rules
          .filter((rule) => rule.pattern.test(line))
          .map((rule) => `${posix(file)}:${index + 1} ${rule.why}`),
      ),
  )

describe('test layering', () => {
  it('still watches the suites the rule was written for', () => {
    // a rename that emptied the sweep would make everything below pass by
    // looking at nothing
    for (const suite of MIGRATED_SUITES) {
      expect(fs.existsSync(suite), `${suite} moved or was deleted`).toBe(true)
    }
  })

  it('keeps the database lifecycle out of every package but the one that owns it', () => {
    const offenders = breaches(
      walk('packages').filter((file) => !posix(file).startsWith(`${OWNS_CONNECTIONS}/`)),
      OWNERSHIP,
    )
    expect(offenders).toEqual([])
  })

  it('keeps it out of scripts that are not calling a PoolClient interface', () => {
    const offenders = breaches(
      walk('scripts').filter((file) => !SCRIPTS_MAY_CONNECT.has(posix(file))),
      OWNERSHIP,
    )
    expect(offenders).toEqual([])
  })

  it('keeps the driver out of every dependency graph but that plugin', () => {
    // pnpm's isolation is the enforcement: without the dependency the import
    // does not resolve at all, whatever a reviewer misses
    const manifests = walkManifests('packages').filter(
      (file) => !posix(file).startsWith(`${OWNS_CONNECTIONS}/`),
    )
    const offenders = manifests.flatMap((file) => {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const all = { ...pkg.dependencies, ...pkg.devDependencies }
      return ['pg', '@types/pg']
        .filter((name) => name in all)
        .map((name) => `${posix(file)} declares ${name}`)
    })
    expect(offenders).toEqual([])
  })

  it('keeps the testkit out of production code', () => {
    // a testkit is a plugin's own test surface, not a back door into it: no
    // production entry point, assembly or service may reach for one
    const production = walk('packages')
      .concat(walk('apps'))
      .filter((file) => !isTestFile(file))
    const offenders = breaches(production, [
      { pattern: /\/testkit['"]/, why: 'imports a testkit from production code' },
    ])
    expect(offenders).toEqual([])
  })
})
