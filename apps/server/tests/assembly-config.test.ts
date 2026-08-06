import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigProvider, Effect, Redacted } from 'effect'
import { lockPathFor } from '@qualy/assembly'
import {
  DatabaseConfig,
  LOCAL_FALLBACK,
  MIGRATIONS_FOLDER,
  config,
} from '@qualy/plugin-database/server'
import { manifestPath } from '../src/config.ts'

// Two facts the assembly owns that no process may decide for itself.
//
// Both of these were wrong at the same time and neither was visible. The
// lineage folder was declared in qualy.yml, read by `qualy generate` and
// `qualy deploy`, and separately hardcoded in the host - so pointing the
// manifest somewhere else would have had the CLI write one lineage while the
// process applied another. Removing the declaration from the manifest entirely
// broke nothing that any test could see, which is how it came to be removed.
//
// The plugin resolves it now, from the block the assembly hands it and the
// manifest's own directory, so these ask the plugin rather than the host.
//
// The lock path had the matching problem from the other direction: it was
// derived from the manifest's DIRECTORY and not its name, so resolving any
// second manifest in packages/app overwrote the product's own lock with a hash
// of the wrong file, silently, and the next frozen start would have refused.

const withManifest = <T>(text: string, run: (file: string) => T): T => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-config-'))
  const file = path.join(dir, 'qualy.yml')
  fs.writeFileSync(file, text)
  const previous = process.env.QUALY_CONFIG
  process.env.QUALY_CONFIG = file
  try {
    return run(file)
  } finally {
    if (previous === undefined) delete process.env.QUALY_CONFIG
    else process.env.QUALY_CONFIG = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const manifest = (body: string) => `version: 2\n\napplication:\n  workspace: .\n\nplugins:\n${body}`

/**
 * What the plugin makes of a manifest block, without opening a database.
 *
 * The environment is supplied rather than mutated: the default provider reads
 * `process.env` once, so a test that assigns to it after the first read is
 * asserting about the first read. That cost an hour.
 */
const configured = (
  declared: Record<string, unknown>,
  manifestDir: string,
  env: Record<string, string> = {},
) =>
  Effect.runPromise(
    Effect.flatMap(DatabaseConfig, Effect.succeed).pipe(
      Effect.provide(config(declared, { manifestDir })),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
  )

const HERE = '/somewhere'

describe('what the manifest decides and the database plugin reads', () => {
  it('takes the lineage folder from the manifest, resolved against it', async () => {
    const read = await configured({ migrationsFolder: '../elsewhere' }, HERE)
    expect(read.migrationsFolder).toBe(path.resolve(HERE, '../elsewhere'))
  })

  it('falls back to the same default the CLI uses when the manifest is silent', async () => {
    // a manifest need not say; what it must not do is mean one folder in the
    // process and another in `qualy generate`. There is one definition of the
    // default now - src/defaults.ts, imported by the plugin and by its
    // assembly - so this asserts the resolution rather than the agreement.
    const read = await configured({}, HERE)
    expect(read.migrationsFolder).toBe(path.resolve(HERE, MIGRATIONS_FOLDER))
  })

  it('honours an absolute declaration as given', async () => {
    const absolute = path.join(os.tmpdir(), 'qualy-absolute-lineage')
    expect((await configured({ migrationsFolder: absolute }, HERE)).migrationsFolder).toBe(absolute)
  })

  it('refuses a manifest block it cannot read', async () => {
    // the alternative is a key that looks applied and is not, which is the
    // failure the whole config channel exists to prevent
    await expect(configured({ url: 'postgres://elsewhere/db' }, HERE)).rejects.toThrow()
  })

  it('assumes a local database only outside production', async () => {
    // a production instance that assumes one connects to whatever postgres is
    // on localhost and, with migrations on, applies the lineage to it
    expect(Redacted.value((await configured({}, HERE, {})).url)).toBe(LOCAL_FALLBACK)
    await expect(configured({}, HERE, { NODE_ENV: 'production' })).rejects.toThrow(
      /DATABASE_URL is not set/,
    )
    // and it is the absence that decides, not the environment: production with
    // one configured is the ordinary case
    expect(
      Redacted.value(
        (await configured({}, HERE, { NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y' }))
          .url,
      ),
    ).toBe('postgres://x/y')
  })

  it('reads the manifest this process was started with', () => {
    withManifest(manifest("  '@qualy/plugin-database': {}\n"), (file) => {
      expect(manifestPath()).toBe(file)
    })
  })

  it("names each manifest's lock after it, so two cannot share one", () => {
    const dir = '/somewhere'
    expect(lockPathFor(path.join(dir, 'qualy.yml'))).toBe(path.join(dir, 'qualy.lock.json'))
    expect(lockPathFor(path.join(dir, 'scratch.yml'))).not.toBe(
      lockPathFor(path.join(dir, 'qualy.yml')),
    )
  })
})
