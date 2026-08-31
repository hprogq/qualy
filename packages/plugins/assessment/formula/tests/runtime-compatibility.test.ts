import { describe, expect, it } from 'vitest'
import {
  checkRuntimeCompatibility,
  storedPatternIssues,
  validateStoredValueSchema,
} from '../src/server/runtime-compatibility.ts'

// The policy that decides whether THIS build may execute a stored version.
// A supported number means "we hold acceptance-semantics evidence for that
// historical language". Profile 1 is NOT in the set: its rows' contract
// hashes reproduce under the current canonicalizer (2026-08-31 inventory),
// but hash identity only proves the schema bytes - while still called v1,
// the language swapped regex engines and date arithmetic, which no schema
// hash can see. So a v1 row answers unsupported until someone implements
// the v1 acceptance semantics and bears them with era-accurate fixtures.
// Provenance never enters: the input type has no field for an engine or a
// toolchain string, so an equality gate on one cannot even be written.

/** a REAL historical v1 row (01a04dbc…, published 2026-08-29): kept as the
 *  specimen of what a v1 row looks like - readable history, not certified
 *  runtime */
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

  it('refuses the historical v1 language until its own semantics are borne', () => {
    // the hash-identity inventory is not acceptance evidence: v1 swapped
    // regex engines and date arithmetic without moving a single hash
    const refused = checkRuntimeCompatibility({ ...current, valueSchemaProfileVersion: 1 })
    expect(refused.map((issue) => issue.facet)).toEqual(['value-schema-profile'])
    expect(refused[0]!.stored).toBe(1)
    expect(
      validateStoredValueSchema(1, HISTORICAL_V1.inputSchema, HISTORICAL_V1.outputSchema).map(
        (issue) => issue.facet,
      ),
    ).toEqual(['value-schema-profile'])
  })

  it('judges stored patterns by the profile dialect, or not at all', () => {
    const withPattern = (pattern: string) => ({
      type: 'object',
      required: ['code'],
      properties: {
        code: { type: 'string', maxLength: 32, pattern },
      },
      additionalProperties: false,
    })
    // a pattern inside the RE2 dialect is compatible
    expect(storedPatternIssues(1, withPattern('^[a-z]{2,8}$'), HISTORICAL_V1.outputSchema)).toEqual(
      [],
    )
    // lookbehind is outside the dialect: unsupported, facet named
    const outside = storedPatternIssues(1, withPattern('(?<=a)b'), HISTORICAL_V1.outputSchema)
    expect(outside.map((issue) => issue.facet)).toEqual(['regex-profile'])
    // an unsupported dialect version is refused BY VERSION, and the stored
    // pattern is never interpreted by the current dialect: one issue, the
    // version's own, however hostile the pattern beside it
    const alien = storedPatternIssues(999, withPattern('(?<=a)b'), HISTORICAL_V1.outputSchema)
    expect(alien).toHaveLength(1)
    expect(alien[0]!.facet).toBe('regex-profile')
    expect(alien[0]!.stored).toBe(999)
    // and the full gate carries the same verdicts through
    expect(
      checkRuntimeCompatibility({
        ...current,
        inputSchema: withPattern('(?<=a)b'),
      }).map((issue) => issue.facet),
    ).toEqual(['regex-profile'])
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
