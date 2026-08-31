import { describe, expect, it } from 'vitest'
import {
  checkRuntimeCompatibility,
  validateStoredValueSchema,
} from '../src/server/runtime-compatibility.ts'

// The policy that decides whether THIS build may execute a stored version.
// A supported number means "we hold replay evidence for that historical
// language" - profile 1 earned its place through the 2026-08-31 inventory,
// where every v1 row canonicalized to its own stored contract hash - and
// provenance never enters: the input type has no field for an engine or a
// toolchain string, so an equality gate on one cannot even be written.

/** a REAL historical v1 row (01a04dbc…, published 2026-08-29): the schemas
 *  exactly as stored, not today's shapes with the number turned down */
const HISTORICAL_V1 = {
  inputSchema: {
    type: 'object',
    required: ['value'],
    properties: {
      value: {
        type: 'string',
        format: 'qualy-decimal',
        'x-qualy-maximum': '10',
        'x-qualy-minimum': '0',
        'x-qualy-maxScale': 2,
      },
    },
    additionalProperties: false,
  },
  outputSchema: { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2 },
}

const current = {
  formulaAbiVersion: 1,
  sandboxAbiVersion: 1,
  valueSchemaProfileVersion: 2,
  regexProfileVersion: 1,
  inputSchema: HISTORICAL_V1.inputSchema,
  outputSchema: HISTORICAL_V1.outputSchema,
}

describe('runtime compatibility', () => {
  it('accepts what this build was published under', () => {
    expect(checkRuntimeCompatibility(current)).toEqual([])
  })

  it('accepts the inventoried historical v1 language', () => {
    expect(checkRuntimeCompatibility({ ...current, valueSchemaProfileVersion: 1 })).toEqual([])
    expect(
      validateStoredValueSchema(1, HISTORICAL_V1.inputSchema, HISTORICAL_V1.outputSchema),
    ).toEqual([])
  })

  it('names the facet that has no evidence', () => {
    const abi = checkRuntimeCompatibility({ ...current, formulaAbiVersion: 999 })
    expect(abi.map((issue) => issue.facet)).toEqual(['formula-abi'])
    const sandbox = checkRuntimeCompatibility({ ...current, sandboxAbiVersion: 999 })
    expect(sandbox.map((issue) => issue.facet)).toEqual(['sandbox-abi'])
    const regex = checkRuntimeCompatibility({ ...current, regexProfileVersion: 999 })
    expect(regex.map((issue) => issue.facet)).toEqual(['regex-profile'])
    const profile = checkRuntimeCompatibility({ ...current, valueSchemaProfileVersion: 999 })
    expect(profile.map((issue) => issue.facet)).toEqual(['value-schema-profile'])
    expect(profile[0]!.stored).toBe(999)
  })

  it('refuses a stored schema outside every supported language', () => {
    const wild = checkRuntimeCompatibility({
      ...current,
      // an unbounded integer is exactly what the profile refuses
      inputSchema: {
        type: 'object',
        required: ['n'],
        properties: { n: { type: 'integer' } },
        additionalProperties: false,
      },
    })
    expect(wild.map((issue) => issue.facet)).toContain('input-schema')
  })
})
