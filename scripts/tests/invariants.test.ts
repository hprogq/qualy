import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSchemaEntries } from '../lib/schema-entries.ts'

// deactivating a plugin in cordis.yml must be invisible to schema
// aggregation: tables outlive deactivation

describe('schema aggregation invariants', () => {
  it('disabling a plugin does not change the schema entry set', () => {
    const baseline = resolveSchemaEntries()
    const yml = fs.readFileSync('cordis.yml', 'utf8')
    const mutated = yml.replace(
      "name: '@qualy/plugin-ping'",
      "name: '@qualy/plugin-ping'\n  disabled: true",
    )
    expect(mutated, 'test fixture must actually disable ping').not.toBe(yml)
    const tmpYml = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-invariant-')),
      'cordis.yml',
    )
    fs.writeFileSync(tmpYml, mutated)
    expect(
      resolveSchemaEntries({ ymlPath: tmpYml }),
      'Disabling a plugin must not alter the aggregated database schema',
    ).toEqual(baseline)
  })
})
