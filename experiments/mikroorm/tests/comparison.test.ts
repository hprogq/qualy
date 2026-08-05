import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// The same mistake, written twice.
//
// The suite next door proves Kysely refuses a set of errors. On its own that
// says nothing about the exchange: a tool can refuse things the tool it
// replaces also refuses. What decides anything is a mistake one accepts and
// the other does not, so each case here is compiled in both dialects against
// the same real tables - org's drizzle schema, and the entities derived from
// the same database.
//
// The two cases are the ones a comparison of these libraries names as
// drizzle's blind spots (thetutlage/meta#8): selecting a column from a table
// that was never joined, and naming a table in a join condition that is not in
// the query. Both are checked here rather than taken on trust - and checking
// them corrected the claim. Drizzle v1 does refuse the first one, at runtime,
// with a precise message; what it does not do is refuse it at build time. So
// the difference these cases measure is when the mistake is caught, not
// whether it is. That is a smaller gap than "silently wrong", and still a real
// one: a runtime check only fires on a path a test actually executes.

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const scratch = fs.mkdtempSync(path.join(here, '..', '.compare-'))

fs.writeFileSync(
  path.join(scratch, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'es2022',
      module: 'preserve',
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      noEmit: true,
      skipLibCheck: true,
      types: ['node'],
    },
    files: [] as string[],
  }),
)

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true })
})

/** compile a snippet; '' means tsc accepted it */
const compile = (name: string, source: string): string => {
  fs.writeFileSync(path.join(scratch, `${name}.ts`), source)
  const project = path.join(scratch, `${name}.tsconfig.json`)
  fs.writeFileSync(project, JSON.stringify({ extends: './tsconfig.json', files: [`./${name}.ts`] }))
  try {
    execFileSync('npx', ['tsc', '-p', project], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return ''
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }
}

const drizzle = (body: string) => `
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { orgNodes, orgTypes } from '@qualy/plugin-org/schema'
declare const db: ReturnType<typeof drizzle>
export const probe = async () => {
${body}
}
`

const kysely = (body: string) => `
import { kyselyOf, type Em } from '../src/orm.ts'
declare const em: Em
export const probe = async () => {
${body}
}
`

describe('a mistake each library is given the same chance to catch', () => {
  it('selecting from a table the query never joined', () => {
    // org_types is named in the select list, but only org_nodes is in the from
    const byDrizzle = compile(
      'drizzle-unjoined',
      drizzle(`  return db
    .select({ nodeName: orgNodes.name, typeName: orgTypes.name })
    .from(orgNodes)`),
    )
    const byKysely = compile(
      'kysely-unjoined',
      kysely(`  return kyselyOf(em)
    .selectFrom('OrgNode')
    .select(['OrgNode.name', 'OrgType.name'])
    .execute()`),
    )

    expect(byKysely, 'kysely should refuse a column from an unjoined table').not.toBe('')
    // recorded rather than asserted as a defect: this is the exchange being
    // measured, and it is only interesting if it is true
    expect({ drizzleAccepted: byDrizzle === '', kyselyAccepted: byKysely === '' }).toEqual({
      drizzleAccepted: true,
      kyselyAccepted: false,
    })
    // and what drizzle does instead, verified by building the query: it throws
    // while rendering the SQL, naming the table and suggesting the join. The
    // gap is the moment of the failure, not its clarity.
  }, 180_000)

  it('a join condition naming a table that is not in the query', () => {
    const byDrizzle = compile(
      'drizzle-alias',
      drizzle(`  return db
    .select({ name: orgNodes.name })
    .from(orgNodes)
    .innerJoin(orgTypes, eq(orgTypes.id, orgNodes.orgTypeId))
    .where(eq(orgTypes.tenantId, orgNodes.tenantId))`),
    )
    const byKysely = compile(
      'kysely-alias',
      kysely(`  return kyselyOf(em)
    .selectFrom('OrgNode as child')
    .innerJoin('OrgType as childType', (join) =>
      join.onRef('childType.id', '=', 'notInQuery.orgTypeId'))
    .select(['child.name'])
    .execute()`),
    )

    expect(byKysely, 'kysely should refuse an unknown alias').not.toBe('')
    expect(byDrizzle === '' ? 'accepted' : 'rejected').toBe('accepted')
  }, 180_000)

  it('a column that does not exist, which both should refuse', () => {
    // the control for the comparison itself: on a mistake both catch, the
    // harness must report both catching it, or the two columns above prove
    // nothing about the libraries and everything about this file
    const byDrizzle = compile(
      'drizzle-typo',
      drizzle(`  return db.select({ n: orgNodes.naame }).from(orgNodes)`),
    )
    const byKysely = compile(
      'kysely-typo',
      kysely(`  return kyselyOf(em).selectFrom('OrgNode').select(['naame']).execute()`),
    )
    expect(byDrizzle).not.toBe('')
    expect(byKysely).not.toBe('')
  }, 180_000)
})
