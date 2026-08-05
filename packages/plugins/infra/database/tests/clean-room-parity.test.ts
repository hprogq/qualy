import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { capabilityWorkContext, commitLock, createWorkspace } from '@qualy/assembly/testkit'
import { readManifest } from '@qualy/assembly'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import provider, { type DatabaseContribution, type DatabaseState } from '../src/assembly/index.ts'
import { createTestContext, postgresAvailable } from '../src/testkit.ts'

// The lineage you can regenerate has to be the lineage you have.
//
// Every migration in db/migrations was either produced by drizzle-kit from a
// plugin's schema or hand-written. The hand-written ones are the hazard: they
// exist only in that directory, so unless an equivalent lives in some plugin's
// baselineDir, a deployment built from the plugins alone silently lacks it.
// That is not hypothetical - `CREATE EXTENSION ltree` was exactly this, and
// every from-scratch deployment failed with `type "ltree" does not exist`.
//
// The clean-room test next door proves a generated lineage deploys and that
// ltree lands. It cannot see anything else going missing, because it only
// counts tables. This compares the two databases object by object instead, so
// a function, trigger, constraint, index or extension that reaches the
// committed lineage without a plugin carrying it fails here.
//
// Column ORDER is deliberately not compared: the committed lineage grew by
// ALTER TABLE ADD COLUMN, which appends, while a from-scratch CREATE TABLE
// uses declaration order. Postgres attaches no meaning to the difference and
// every query in the codebase names its columns.

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')
const committedLineage = path.join(repoRoot, 'db/migrations')

/** the product's own selection, read rather than restated so it cannot drift */
const productSelection = (): string[] => {
  const manifest = readManifest(path.join(repoRoot, 'apps/server/qualy.yml'))
  return [...manifest.plugins.keys()]
}

const CATALOG = {
  columns: `select table_name || '.' || column_name || ' ' || data_type
              || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')
            from information_schema.columns
            where table_schema = 'public' and table_name <> '__drizzle_migrations'
            order by 1`,
  constraints: `select conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
                from pg_constraint where connamespace = 'public'::regnamespace order by 1`,
  indexes: `select indexdef from pg_indexes
            where schemaname = 'public' and tablename <> '__drizzle_migrations' order by 1`,
  routines: `select p.proname || '/' || pg_get_function_identity_arguments(p.oid)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' order by 1`,
  triggers: `select c.relname || '.' || t.tgname
             from pg_trigger t join pg_class c on c.oid = t.tgrelid
             where not t.tgisinternal order by 1`,
  extensions: `select extname from pg_extension order by 1`,
}

describe.runIf(postgresAvailable)('a lineage rebuilt from the plugins alone', () => {
  it(
    'produces the same database as the committed lineage',
    async () => {
      const workspace = createWorkspace(productSelection(), {
        configs: { '@qualy/plugin-database': { migrationsFolder: 'migrations' } },
      })
      try {
        await commitLock(workspace)
        const work = (await capabilityWorkContext(workspace, 'database')) as CapabilityWorkContext<
          DatabaseContribution,
          DatabaseState
        >
        await provider.generate!(work)

        // both applied the way production applies them, so this compares
        // deployments rather than a replay written for the test
        const fresh = await createTestContext('parity-fresh', {
          migrationsFolder: path.join(workspace.dir, 'migrations'),
        })
        const committed = await createTestContext('parity-committed', {
          migrationsFolder: committedLineage,
        })
        try {
          const seen: Record<string, string[]> = {}
          for (const [what, query] of Object.entries(CATALOG)) {
            const left = (await committed.query<Record<string, string>>(query)).rows.map(
              (row) => Object.values(row)[0]!,
            )
            const right = (await fresh.query<Record<string, string>>(query)).rows.map(
              (row) => Object.values(row)[0]!,
            )
            expect(right, `${what} differ; something in db/migrations is not carried by any plugin`)
              .toEqual(left)
            seen[what] = left
          }

          // Anchors, so two empty databases cannot agree their way to green.
          // Not "every category is non-empty": this schema has no triggers,
          // the two the lineage created having been dropped by the migration
          // that removed the columns they read.
          expect(seen.extensions).toContain('ltree')
          expect(seen.columns).toContain('org_nodes.path USER-DEFINED null=NO default=-')
          expect(seen.columns!.length).toBeGreaterThan(100)
          expect(seen.constraints!.length).toBeGreaterThan(100)
          expect(seen.indexes!.length).toBeGreaterThan(40)
        } finally {
          await fresh.dispose()
          await committed.dispose()
        }
      } finally {
        workspace.dispose()
      }
    },
    180_000,
  )
})
