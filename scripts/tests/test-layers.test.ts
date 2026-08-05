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
  /(?:^|\/)(?:tests|__tests__|spec)\//.test(posix(file)) || /\.(?:test|spec)\.[cm]?tsx?$/.test(file)

const OWNS_CONNECTIONS = 'packages/plugins/infra/database'

// The scripts whose public interface is a PoolClient, named to the file. A
// directory-wide exemption would quietly cover whatever is added next to
// them.
const SCRIPTS_MAY_CONNECT = new Set([
  'scripts/seed.ts',
  'scripts/lib/seed.ts',
  'scripts/tests/seed.test.ts',
  // this file states the patterns, so it contains all of them
  'scripts/tests/test-layers.test.ts',
])

// Pinned to the file, because these are the suites the rule was written for.
// Deleting, moving or renaming one has to be a decision the diff shows.
const MIGRATED_SUITES = [
  'packages/plugins/base/auth/tests/schema.test.ts',
  'packages/plugins/base/auth/tests/effect-parity.test.ts',
  'packages/plugins/base/auth/tests/effect-sign-in.test.ts',
  'packages/plugins/base/org/tests/schema.test.ts',
  'packages/plugins/base/org/tests/effect-parity.test.ts',
  'packages/plugins/base/rbac/tests/effect-parity.test.ts',
]

const OWNERSHIP: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /from ['"]pg['"]/, why: 'imports the postgres driver' },
  { pattern: /new Pool\(/, why: 'constructs its own connection pool' },
  { pattern: /plugin-database\/migrator/, why: 'runs the migration lineage itself' },
  { pattern: /process\.env\.DATABASE_URL/, why: 'reads the connection string' },
  { pattern: /QUALY_REQUIRE_POSTGRES_TESTS/, why: 'reimplements the availability policy' },
  { pattern: /create database|drop database/i, why: 'manages database lifetime' },
]

const breaches = (
  files: readonly string[],
  rules: readonly { pattern: RegExp; why: string; skipLine?: (line: string) => boolean }[],
) =>
  files.flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        rules
          .filter((rule) => rule.pattern.test(line) && !rule.skipLine?.(line))
          .map((rule) => `${posix(file)}:${index + 1} ${rule.why}`),
      ),
  )

// What the assembly core is allowed to know.
//
// The core resolves a manifest into a lock and calls capability providers at
// fixed points; a database is one capability among the ones there could be,
// owned by an optional plugin. Nothing about it may leak back: not an
// identifier, not a dependency, not a filename convention. A regex is a blunt
// gate, but the failure it prevents is subtle, and the last time this boundary
// existed only as prose the core grew a databaseOrder field.
const CORE = ['packages/assembly/src', 'packages/assembly-contract/src']
const DATABASE_WORDS =
  /\bdrizzle|\bpostgres|\bmigration|\bschemaEntry|\bbaselineDir|\bdatabaseOrder|qualy\.database\b/i
// Comments explain the boundary and have to be free to name what is on the
// other side of it; code may not depend on it. There is no allowlist: an
// exempt file is an exempt file, and the regression this exists to catch would
// be written inside one.
const codeOnly = (source: string) =>
  source.split('\n').map((line) =>
    line
      .replace(/\/\*.*?\*\//g, '')
      .replace(/\/\/.*$/, '')
      .replace(/^\s*\*.*$/, ''),
  )

describe('assembly core', () => {
  it('does not name a capability it is supposed to know nothing about', () => {
    const offenders = CORE.flatMap(walk).flatMap((file) =>
      codeOnly(fs.readFileSync(file, 'utf8')).flatMap((line, index) =>
        DATABASE_WORDS.test(line) ? [`${posix(file)}:${index + 1} ${line.trim()}`] : [],
      ),
    )
    expect(offenders).toEqual([])
  })

  it('does not depend on a database package', () => {
    const forbidden = ['drizzle-orm', 'drizzle-kit', 'pg', '@types/pg']
    const offenders = ['packages/assembly', 'packages/assembly-contract'].flatMap((dir) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const all = { ...pkg.dependencies, ...pkg.devDependencies }
      return forbidden.filter((name) => name in all).map((name) => `${dir} declares ${name}`)
    })
    expect(offenders).toEqual([])
  })

  it('keeps the repository root out of the database toolchain', () => {
    // The root used to carry drizzle-kit, drizzle-orm and the drizzle config
    // itself, which made every assembly a database assembly. What is left is
    // pinned rather than forbidden: the seed still writes rows through pg and
    // has no owning capability yet, so it keeps the driver, and a NEW database
    // dependency at the root has to change this list to land.
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      devDependencies?: Record<string, string>
    }
    const remaining = ['drizzle-kit', 'drizzle-orm', 'pg', '@types/pg', '@electric-sql/pglite']
      .filter((name) => name in (pkg.devDependencies ?? {}))
      .sort()
    expect(remaining).toEqual(['@types/pg', 'pg'])
    expect(fs.existsSync('drizzle.config.ts')).toBe(false)
  })
})

/** every package that declares itself a capability provider, and where its entry lives */
const providerEntries = () =>
  walkManifests('packages').flatMap((file) => {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      qualy?: { capabilityProvider?: { entry?: string } }
      exports?: Record<string, string>
    }
    const entry = pkg.qualy?.capabilityProvider?.entry
    if (!entry) return []
    const target = pkg.exports?.[entry]
    if (!target) throw new Error(`${file}: capabilityProvider.entry ${entry} is not an export`)
    return [path.dirname(path.join(path.dirname(file), target))]
  })

describe('capability provider entry', () => {
  it('reaches nothing that would run on import', () => {
    // The entry is imported by a CLI with no cordis context and nothing that
    // has agreed to open a connection; one careless static import turns
    // `qualy resolve` into a service start. Found by declaration rather than by
    // directory name, so the second provider is covered the day it lands.
    const forbidden = [
      { pattern: /from ['"](?:cordis|@cordisjs\/[^'"]+)['"]/, why: 'imports cordis' },
      { pattern: /from ['"]\.\.\/index\.ts['"]/, why: 'imports the runtime plugin' },
      { pattern: /testkit/, why: 'reaches a testkit' },
      { pattern: /^import .*['"]drizzle-kit['"]/, why: 'statically imports a dev dependency' },
    ]
    const directories = providerEntries()
    expect(directories.length).toBeGreaterThan(0)
    expect(breaches(directories.flatMap(walk), forbidden)).toEqual([])
  })
})

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

  it('leaves no way to be trusted by omission', () => {
    // authorization used to be skippable by forgetting an argument: the actor
    // was optional and the in-lock checks opened with an early return when it
    // was absent. No production call site forgot, but the type allowed it and
    // the tests depended on it, so authorization was skippable for test
    // convenience. A caller that forgets and a caller that is trusted must not
    // look the same.
    const services = walk('packages/plugins').filter((file) => !isTestFile(file))
    const offenders = breaches(services, [
      { pattern: /\bactor\?:\s*Principal/, why: 'declares an optional actor' },
      { pattern: /\bas\?:\s*Principal/, why: 'declares an optional actor' },
      // a BARE return is the dangerous one: it skips the check. Returning a
      // value is a decision, and `if (!principal) return { permissions: none }`
      // denies an anonymous viewer rather than waving them through
      { pattern: /if \(!actor\)\s*return\s*$/m, why: 'skips the check when the actor is absent' },
      {
        pattern: /if \(!principal\)\s*return\s*$/m,
        why: 'skips the check when the principal is absent',
      },
    ])
    expect(offenders).toEqual([])
  })

  it('lets one place in the process build a database client', () => {
    // The ambient transaction rests on this and nothing else says so. A call
    // made inside a transaction joins it because the connection travels in the
    // fiber, but the key that carries it is minted per client instance
    // (SqlClient.ts:139, :326-329), so a second client silently reintroduces
    // exactly the second-connection-under-a-held-lock deadlock that deleting
    // the handle parameter was supposed to make impossible. The type system
    // cannot see client identity in either direction.
    const production = walk('packages')
      .concat(walk('apps'))
      .filter((file) => !isTestFile(file))
      .filter((file) => !posix(file).startsWith(`${OWNS_CONNECTIONS}/`))
    const offenders = breaches(production, [
      { pattern: /PgClient\.(?:layer|make|makeWithDefaults)/, why: 'builds its own database client' },
      { pattern: /from ['"]@effect\/sql-pg['"]/, why: 'reaches the postgres driver directly' },
    ])
    expect(offenders).toEqual([])
  })

  it('runs effects only at the edges', () => {
    // An Effect is a description until something runs it. A service, repo or
    // handler that runs its own loses the caller's fiber, and with it the
    // ambient transaction, the interruption and the error channel the caller
    // was relying on. Running belongs at the boundaries: the process entry,
    // the CLI, the browser's one runtime, and tests.
    const RUNS_EFFECTS = [
      'apps/server/src/effect/main.ts',
      // the browser's single runtime: pages hand it effects rather than
      // running them, which is what carries E across into the query's TError
      'packages/api-client/src/effect/query.ts',
      // the browser's composition root, and it runs exactly one effect:
      // building the client. Everything after that is handed to the runtime
      // above rather than run in a component.
      'apps/web/src/App.tsx',
    ]
    // A comment is not a call. The pattern matches the name anywhere in the
    // file, so prose explaining why a boundary is where it is would otherwise
    // read as a breach of it.
    const commented = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line)
    const production = walk('packages')
      .concat(walk('apps'))
      .filter((file) => !isTestFile(file))
      // A testkit is a test boundary that happens to live in src/, and the
      // next test is what keeps it out of production: no production module is
      // allowed to import one, so running effects here reaches no shipped path.
      .filter((file) => !posix(file).endsWith('/src/testkit.ts'))
      .filter((file) => !RUNS_EFFECTS.includes(posix(file)))
    const offenders = breaches(production, [
      {
        pattern: /Effect\.run(?:Promise|Sync|Fork|PromiseExit|SyncExit)\b/,
        why: 'runs an effect outside an entry point',
        skipLine: commented,
      },
    ])
    expect(offenders).toEqual([])
  })

  it('keeps the testkit out of production code', () => {
    // a testkit is a plugin's own test surface, not a back door into it: no
    // production entry point, assembly or service may reach for one
    const production = walk('packages')
      .concat(walk('apps'))
      .filter((file) => !isTestFile(file))
    const offenders = breaches(production, [
      { pattern: /\/testkit(?:\.ts)?['"]/, why: 'imports a testkit from production code' },
    ])
    expect(offenders).toEqual([])
  })
})
