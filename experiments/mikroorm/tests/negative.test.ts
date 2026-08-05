import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// What the type system actually refuses.
//
// "Kysely is more strictly typed" is a claim about a product; this is the
// claim about Qualy's entities, which is the one that decides anything. Each
// case is a mistake the current hand-written SQL makes silently - a column
// that does not exist, a field selected but never read, a join alias that was
// renamed - compiled for real and required to fail.
//
// The positive control matters as much as the negatives: if the harness were
// misconfigured every case would "fail to compile" and the suite would look
// like a success.

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

// Inside the package, not in os.tmpdir(): a probe compiled somewhere else
// resolves no node_modules, and would fail for that reason rather than for the
// mistake it is meant to demonstrate.
const scratch = fs.mkdtempSync(path.join(here, '..', '.probe-'))
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

const PRELUDE = `
import { kyselyOf, type Em } from '../src/orm.ts'
declare const em: Em
export const probe = async () => {
`

/** compile one snippet against the real entities, and report what tsc said */
const compile = (name: string, body: string): string => {
  const file = path.join(scratch, `${name}.ts`)
  fs.writeFileSync(file, `${PRELUDE}${body}\n}\n`)
  const project = path.join(scratch, `${name}.tsconfig.json`)
  fs.writeFileSync(
    project,
    JSON.stringify({
      extends: './tsconfig.json',
      files: [`./${name}.ts`],
    }),
  )
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

describe('what a mistyped query does at build time', () => {
  it('compiles a correct query, so the harness proves something', () => {
    // the positive control
    expect(
      compile(
        'control',
        `const rows = await kyselyOf(em).selectFrom('OrgType').select(['id', 'sortOrder']).execute()
         return rows[0]?.sortOrder`,
      ),
    ).toBe('')
  }, 120_000)

  it('refuses a column that does not exist', () => {
    expect(
      compile(
        'bad-column',
        `await kyselyOf(em).selectFrom('OrgType').select(['id', 'sortOrderr']).execute()`,
      ),
    ).toMatch(/sortOrderr/)
  }, 120_000)

  it('refuses a table that does not exist', () => {
    expect(
      compile('bad-table', `await kyselyOf(em).selectFrom('OrgTypes').selectAll().execute()`),
    ).toMatch(/OrgTypes/)
  }, 120_000)

  it('refuses reading a field the select list did not ask for', () => {
    // the failure the hand-written version cannot see: drop a column from the
    // select list and every reader keeps compiling against the Row interface
    expect(
      compile(
        'unselected',
        `const rows = await kyselyOf(em).selectFrom('OrgType').select(['id']).execute()
         return rows[0]?.sortOrder`,
      ),
    ).toMatch(/sortOrder/)
  }, 120_000)

  it('refuses a join alias that was renamed', () => {
    expect(
      compile(
        'bad-alias',
        `await kyselyOf(em)
           .selectFrom('OrgNode as child')
           .innerJoin('OrgType as childType', (join) =>
             join.onRef('childType.id', '=', 'kid.orgTypeId'))
           .select(['childType.name'])
           .execute()`,
      ),
    ).toMatch(/kid/)
  }, 120_000)

  it('refuses comparing a uuid column against a number', () => {
    expect(
      compile(
        'wrong-type',
        `await kyselyOf(em).selectFrom('OrgType').select('id').where('id', '=', 42).execute()`,
      ),
    ).toMatch(/42|number/)
  }, 120_000)

  it('refuses writing a column the entity does not have', () => {
    expect(
      compile(
        'bad-update',
        `await kyselyOf(em).updateTable('OrgNode').set({ orgTypeId: 'x', nope: 1 }).execute()`,
      ),
    ).toMatch(/nope/)
  }, 120_000)
})
