import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Does the type chain survive being assembled from separate plugins?
//
// Everything measured so far used one hand-written tuple. An assembly does not
// have one: each plugin owns its own, the host concatenates whichever the
// manifest selected, and the question is whether the entity types reach Kysely
// through that concatenation - and whether a plugin, which must not depend on
// the aggregate, can still be typed against its own closure.
//
// These are compile-time properties, so they are compiled. The positive
// controls come first: if the aggregate could not query anything, every
// negative below would pass for the wrong reason.

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const scratch = fs.mkdtempSync(path.join(here, '..', '.wiring-'))

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

const compile = (name: string, body: string): string => {
  fs.writeFileSync(
    path.join(scratch, `${name}.ts`),
    `import { kyselyOf } from '../src/orm.ts'
import type { AssemblyEntityManager, OrgEntityManager } from '../src/wiring.ts'
declare const em: AssemblyEntityManager
declare const orgEm: OrgEntityManager
export const probe = async () => {
${body}
}
`,
  )
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

describe('the type chain across a concatenated assembly', () => {
  it('lets the aggregate reach every plugin that contributed', () => {
    // one query per contributing plugin, through the concatenated tuple
    expect(
      compile(
        'aggregate',
        `  const t = await kyselyOf(em).selectFrom('OrgNode').select(['id', 'path']).execute()
  const u = await kyselyOf(em).selectFrom('User').select(['id', 'userTypeId']).execute()
  const r = await kyselyOf(em).selectFrom('RoleGrant').select(['id', 'coverage']).execute()
  return [t[0]?.path, u[0]?.userTypeId, r[0]?.coverage]`,
      ),
    ).toBe('')
  }, 180_000)

  it('types a plugin against its own closure, without the aggregate', () => {
    expect(
      compile(
        'closure',
        `  const rows = await kyselyOf(orgEm).selectFrom('OrgType').select(['id', 'code']).execute()
  return rows[0]?.code`,
      ),
    ).toBe('')
  }, 180_000)

  it('refuses a plugin reaching a table outside its closure', () => {
    // org declares no database dependency on rbac, so org's queries must not
    // compile against rbac's tables. Without this the closure type is
    // decoration: everything would resolve through the aggregate anyway, and
    // the plugin would depend on the host without saying so.
    expect(
      compile(
        'outside-closure',
        `  return kyselyOf(orgEm).selectFrom('RoleGrant').select(['id']).execute()`,
      ),
    ).toMatch(/RoleGrant/)
  }, 180_000)

  it('refuses a column that no contributing plugin declares', () => {
    expect(
      compile(
        'unknown-column',
        `  return kyselyOf(em).selectFrom('User').select(['nickname']).execute()`,
      ),
    ).toMatch(/nickname/)
  }, 180_000)

  it('loses every table when the tuple is widened', () => {
    // The failure mode this whole file exists to pin down. A generator that
    // emits `EntitySchema[]` instead of a tuple produces code that still looks
    // right, and the first error appears at some query far away.
    expect(
      compile(
        'widened',
        `  type Widened = typeof em & { '~entities': unknown[] }
  declare const wide: Widened
  return kyselyOf(wide as never).selectFrom('OrgNode').select(['id']).execute()`,
      ),
    ).not.toBe('')
  }, 180_000)
})
