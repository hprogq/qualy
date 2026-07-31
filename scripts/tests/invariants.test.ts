import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveSchemaEntries } from '../lib/schema-entries.ts'

// deactivating a plugin in cordis.yml must be invisible to schema
// aggregation: tables outlive deactivation

describe('schema aggregation invariants', () => {
  it('disabling a plugin does not change the schema entry set', () => {
    const baseline = resolveSchemaEntries()
    const yml = fs.readFileSync('cordis.yml', 'utf8')
    try {
      fs.writeFileSync(
        'cordis.yml',
        yml.replace("name: '@qualy/plugin-ping'", "name: '@qualy/plugin-ping'\n  disabled: true"),
      )
      expect(
        resolveSchemaEntries(),
        'Disabling a plugin must not alter the aggregated database schema',
      ).toEqual(baseline)
    } finally {
      fs.writeFileSync('cordis.yml', yml)
    }
  })
})
