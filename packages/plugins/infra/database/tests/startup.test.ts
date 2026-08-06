import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineEntity, type EntitySchema } from '@mikro-orm/core'
import { Cause, Effect, Exit, Layer, Option, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  DatabaseConfig,
  DatabaseStartupFailed,
  Entities,
  MigrationFailed,
  layer as databaseLayer,
} from '../src/server/index.ts'
import { layer as ormLayer } from '../src/server/orm.ts'
import { postgresAvailable, createTestContext } from '../src/testkit.ts'

// What a database that will not cooperate does to an assembly.
//
// All three answers are in the layer's error channel, which is the claim this
// plugin makes about itself. Two of them used to be defects: the type said the
// layer could only fail by being behind its lineage, and everything else killed
// the process with a driver stack trace instead.

const build = <A>(
  config: {
    url: string
    migrations?: 'apply' | 'off'
    migrationsFolder?: string
    entities?: readonly EntitySchema[]
  },
  // the composed layer is what an application builds; the orm on its own is
  // for what fails once the lineage has been dealt with
  what: Layer.Layer<A, unknown, DatabaseConfig | Entities>,
) =>
  Effect.runPromiseExit(
    Effect.scoped(
      Layer.build(
        what.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                DatabaseConfig,
                DatabaseConfig.of({
                  url: Redacted.make(config.url),
                  migrations: config.migrations ?? 'apply',
                  migrationsFolder: config.migrationsFolder ?? path.join(os.tmpdir(), 'no-lineage'),
                  poolSize: 1,
                }),
              ),
              Layer.succeed(Entities, config.entities ?? []),
            ),
          ),
        ),
      ),
    ),
  )

/** the failure a caller could have caught, as opposed to a defect */
const failure = (exit: Exit.Exit<unknown, unknown>): unknown => {
  if (Exit.isSuccess(exit)) throw new Error('the layer built when it should not have')
  const error = Cause.findErrorOption(exit.cause)
  if (Option.isNone(error)) {
    throw new Error(`the layer died rather than failing: ${Cause.pretty(exit.cause)}`)
  }
  return error.value
}

describe('a database that stops an assembly from being built', () => {
  it('fails rather than dies when the server cannot be reached', async () => {
    // port 1 is not a postgres, whatever else is true of this machine
    const unreachable = { url: 'postgresql://qualy:qualy@127.0.0.1:1/nothing' }
    // the migrator is what finds out, in both modes and before the orm exists:
    // `MikroORM.init` builds metadata and an entity manager without opening a
    // connection, so on its own it would have started against nothing
    const applying = failure(await build(unreachable, databaseLayer))
    expect(applying).toBeInstanceOf(MigrationFailed)
    expect((applying as MigrationFailed).message).toMatch(/could not apply the lineage/)

    const reading = failure(await build({ ...unreachable, migrations: 'off' }, databaseLayer))
    expect(reading).toBeInstanceOf(MigrationFailed)
    expect((reading as MigrationFailed).message).toMatch(/could not read the migration ledger/)
  })

  it('fails rather than dies when the entity set will not load', async () => {
    const entities = [
      defineEntity({ name: 'One', tableName: 'same_table', properties: {} }),
      defineEntity({ name: 'Two', tableName: 'same_table', properties: {} }),
    ] as unknown as readonly EntitySchema[]
    const exit = await build(
      { url: 'postgresql://qualy:qualy@127.0.0.1:1/nothing', entities },
      ormLayer,
    )
    expect(failure(exit)).toBeInstanceOf(DatabaseStartupFailed)
  })

  it.runIf(postgresAvailable)(
    'fails rather than dies when a migration will not apply',
    async () => {
      // an empty lineage rather than 'off': the point is an empty database, and
      // 'off' would refuse to start against one before this test said anything
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-empty-lineage-'))
      const db = await createTestContext('startup-broken-lineage', { migrationsFolder: empty })
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lineage-'))
      try {
        fs.writeFileSync(path.join(folder, '00000000000001_broken.sql'), 'CREATE TABLE ;\n')
        const exit = await build({ url: db.url, migrationsFolder: folder }, databaseLayer)
        expect(failure(exit)).toBeInstanceOf(MigrationFailed)
      } finally {
        fs.rmSync(folder, { recursive: true, force: true })
        fs.rmSync(empty, { recursive: true, force: true })
        await db.dispose()
      }
    },
  )
})
