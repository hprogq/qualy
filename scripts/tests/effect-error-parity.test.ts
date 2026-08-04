import { describe, expect, it } from 'vitest'
import { HttpApi, OpenApi } from 'effect/unstable/httpapi'
import { QUALY_API_ID } from '@qualy/api-kit'
import { orgApiGroup } from '@qualy/plugin-org/api'
import { orgErrors } from '@qualy/plugin-org/errors'

// The two runtimes have to agree about failures, not just about paths.
//
// A wire code is what the client's translation catalog is keyed by and what an
// integrator matches on, so the same failure has to carry the same code and
// the same status whichever runtime answered. Drift here does not break a
// build or fail a request: it shows the user an untranslated string on one
// path and a localized one on the other, or a 409 where a 422 was documented.
//
// This was not hypothetical. The port renamed one code and moved three
// statuses, and nothing noticed until the ported errors were read side by side
// against the ones the client already knows.

const document = OpenApi.fromApi(HttpApi.make(QUALY_API_ID).add(orgApiGroup)) as {
  components: {
    schemas: Record<string, { properties?: { _tag?: { enum?: string[] } } }>
  }
  paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>
}

/** every code the Effect org endpoints can put on the wire */
const effectCodes = () =>
  Object.values(document.components.schemas)
    .flatMap((schema) => schema.properties?._tag?.enum ?? [])
    .filter((code) => code.startsWith('ORG_'))

/** the status the document says each of those carries */
const effectStatuses = () => {
  const byCode = new Map<string, number>()
  for (const methods of Object.values(document.paths)) {
    for (const operation of Object.values(methods)) {
      for (const [status, body] of Object.entries(operation.responses ?? {})) {
        const ref = JSON.stringify(body)
        for (const code of effectCodes()) {
          // the response body references the schema named after the code's
          // identifier, so match on the tag the schema declares
          const schemaName = Object.entries(document.components.schemas).find(
            ([, schema]) => schema.properties?._tag?.enum?.includes(code),
          )?.[0]
          if (schemaName && ref.includes(schemaName)) byCode.set(code, Number(status))
        }
      }
    }
  }
  return byCode
}

describe('org failures across both runtimes', () => {
  it('found codes on both sides to compare', () => {
    expect(effectCodes().length).toBeGreaterThan(3)
    expect(Object.keys(orgErrors.definitions).length).toBeGreaterThan(3)
  })

  it('raises only codes the oRPC side already declares', () => {
    // the client catalog is closed over those codes, so a new one is a failure
    // the user sees in English
    const declared = new Set(Object.keys(orgErrors.definitions))
    const invented = effectCodes().filter((code) => !declared.has(code))
    expect(
      invented,
      'this code has no translation: use the one the oRPC contract already declares',
    ).toEqual([])
  })

  it('gives each code the status the oRPC side gives it', () => {
    const definitions = orgErrors.definitions as Record<string, { status: number }>
    const drift = [...effectStatuses()]
      .filter(([code]) => definitions[code])
      .filter(([code, status]) => definitions[code]!.status !== status)
      .map(([code, status]) => `${code} is ${status} here and ${definitions[code]!.status} on oRPC`)
    expect(drift).toEqual([])
  })
})
