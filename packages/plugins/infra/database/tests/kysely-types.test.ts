import { defineEntity } from '@mikro-orm/core'
import { describe, expect, it } from 'vitest'
import { kyselyOf, type ClosureEntityManager } from '../src/server/index.ts'

// Which columns a kysely insert may leave out.
//
// A column the database fills has to be omittable, or every insert in the
// codebase names an id the database would have generated - and the ddl default
// stops being the single source it was put there to be.
//
// This is a type test. It runs no sql and asserts nothing at runtime; the
// assertion is that `pnpm typecheck` accepts the calls below and rejects the
// ones marked as errors. The root tsconfig covers this directory, so a
// regression fails the gate rather than sitting here green.

const p = defineEntity.properties

const Probe = defineEntity({
  name: 'Probe',
  tableName: 'probe',
  properties: {
    // the two forms of database-side default, which is the whole question:
    // `default` takes a value, `defaultRaw` takes sql, and the documentation
    // says to use the second one for functions like these
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    createdAt: p.datetime().defaultRaw('now()'),
    // the same declaration with two different values. Before the patch these
    // behaved differently: the check asked whether the recorded default WAS
    // the literal `true`, so a column defaulting to true was omittable and one
    // defaulting to false was not
    enabled: p.boolean().default(true),
    disabled: p.boolean().default(false),
    count: p.integer().default(0),
    // nullable and defaulted at once. `nullable` is tested first by the type
    // that decides this, so it can answer before it has looked at the default
    nullableWithDefault: p.datetime().nullable().defaultRaw('now()'),
    // no default anywhere: the one column that must stay required
    required: p.string().length(63),
  },
})

const entities = [Probe] as const

declare const em: ClosureEntityManager<typeof entities>

// Never called. Everything asserted here is asserted by the compiler, and
// running it would need a real connection to say nothing extra.
function insertShapes() {
  const db = kyselyOf(em)

  // the shape almost every insert in this codebase has: say what the row
  // means, let the database say what it generates
  void db.insertInto('Probe').values({ required: 'x' })

  // and supplying them is still allowed, for the writes that need an id
  // before the row exists
  void db.insertInto('Probe').values({
    id: '00000000-0000-7000-8000-000000000000',
    createdAt: new Date(),
    enabled: false,
    disabled: true,
    count: 3,
    nullableWithDefault: null,
    required: 'x',
  })

  // A column with no default is not optional. Without this the two cases above
  // would pass just as well if the patch had made every column omittable, and
  // an insert missing a required value would compile and fail at runtime.
  // @ts-expect-error required has no default and may not be left out
  void db.insertInto('Probe').values({})
}

describe('what a kysely insert may leave out', () => {
  it('is decided by the compiler, above', () => {
    // vitest needs a case in the file; the gate is `pnpm typecheck`, which
    // covers this directory. A patch that stopped applying would fail there.
    expect(typeof insertShapes).toBe('function')
  })
})
