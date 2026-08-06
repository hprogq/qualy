import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lockPathFor } from '@qualy/assembly'
import { LOCAL_FALLBACK } from '@qualy/plugin-database/assembly'
import { localFallback, manifestMigrationsFolder, manifestPath } from '../src/config.ts'

// Two facts the assembly owns that this process must not decide for itself.
//
// Both of these were wrong at the same time and neither was visible. The
// lineage folder was declared in qualy.yml, read by `qualy generate` and
// `qualy deploy`, and separately hardcoded here - so pointing the manifest
// somewhere else would have had the CLI write one lineage while the process
// applied another. Removing the declaration from the manifest entirely broke
// nothing that any test could see, which is how it came to be removed.
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

describe('what the manifest decides and this process reads', () => {
  it('takes the lineage folder from the manifest, resolved against it', () => {
    withManifest(
      manifest("  '@qualy/plugin-database':\n    config:\n      migrationsFolder: ../elsewhere\n"),
      (file) => {
        expect(manifestMigrationsFolder()).toBe(path.resolve(path.dirname(file), '../elsewhere'))
      },
    )
  })

  it('falls back to the same default the CLI uses when the manifest is silent', () => {
    // a manifest need not say; what it must not do is mean one folder here and
    // another in `qualy generate`, whose default is 'db/migrations' relative
    // to the manifest (packages/plugins/infra/database/src/assembly/work.ts)
    withManifest(manifest("  '@qualy/plugin-database': {}\n"), (file) => {
      expect(manifestMigrationsFolder()).toBe(path.resolve(path.dirname(file), 'db/migrations'))
    })
  })

  it('honours an absolute declaration as given', () => {
    const absolute = path.join(os.tmpdir(), 'qualy-absolute-lineage')
    withManifest(
      manifest(`  '@qualy/plugin-database':\n    config:\n      migrationsFolder: ${absolute}\n`),
      () => {
        expect(manifestMigrationsFolder()).toBe(absolute)
      },
    )
  })

  it('reads the manifest this process was started with', () => {
    withManifest(manifest("  '@qualy/plugin-database': {}\n"), (file) => {
      expect(manifestPath()).toBe(file)
    })
  })

  it('agrees with the CLI about where a database is when nothing says', () => {
    // the same string in two packages: the CLI reaches it through the assembly
    // subpath and the process must not import that, so equality is asserted
    // rather than shared. Drift would send `qualy deploy` and the application
    // to different databases on a machine with no DATABASE_URL set.
    expect(localFallback).toBe(LOCAL_FALLBACK)
  })

  it("names each manifest's lock after it, so two cannot share one", () => {
    const dir = '/somewhere'
    expect(lockPathFor(path.join(dir, 'qualy.yml'))).toBe(path.join(dir, 'qualy.lock.json'))
    expect(lockPathFor(path.join(dir, 'scratch.yml'))).not.toBe(
      lockPathFor(path.join(dir, 'qualy.yml')),
    )
  })
})
