import { describe, expect, it } from 'vitest'
import { OpenApi } from 'effect/unstable/httpapi'
import { qualyApi } from '@qualy/api'

// Two different names, each with its own rule.
//
// The wire code is what a client matches on and what a translation is keyed
// by, so it is upper snake like every domain error in the project. The schema
// identifier is what the generated document calls the model, so it reads like
// a type. They are separable, and letting the code double as the identifier is
// how a document ends up listing ORG_NODE_NOT_FOUNDEncoded.
//
// The "Encoded" suffix itself is upstream's, not ours: the document describes
// the encoded form, and a schema whose encoded side has no identifier of its
// own gets the type's name plus that suffix. Upstream's own tests assert it
// (repos/effect/.../OpenApiRepresentation.test.ts). Naming the identifier does
// not remove the suffix, it just stops the code being shouted.

const document = () =>
  OpenApi.fromApi(qualyApi) as {
    components: { schemas: Record<string, { properties?: { _tag?: { enum?: string[] } } }> }
  }

describe('error schemas in the generated document', () => {
  it('found error models to check', () => {
    const tagged = Object.values(document().components.schemas).filter(
      (schema) => schema.properties?._tag?.enum,
    )
    expect(tagged.length).toBeGreaterThan(0)
  })

  it('names the model like a type, not like a code', () => {
    const shouted = Object.entries(document().components.schemas)
      .filter(([, schema]) => schema.properties?._tag?.enum)
      .map(([name]) => name)
      .filter((name) => /[A-Z]{2,}_|^[A-Z_]+$/.test(name.replace(/Encoded$/, '')))
    expect(
      shouted,
      'set an `identifier` annotation: the error code should not be the model name',
    ).toEqual([])
  })

  it('keeps every wire code upper snake', () => {
    const codes = Object.values(document().components.schemas)
      .flatMap((schema) => schema.properties?._tag?.enum ?? [])
      .filter((code) => !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(code))
    expect(codes, 'a domain error code is upper snake, as defineDomainErrors requires').toEqual(
      [],
    )
  })
})
