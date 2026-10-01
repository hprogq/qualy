import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { currentResolution } from '@qualy/assembly/host'
import { Plugin } from '@qualy/plugin-kit'
import { commonErrorCodes } from '@qualy/i18n-contract'
import { ApiGroups } from '../../packages/core/api-kit/src/plugin.ts'
import { validateErrorCodes } from '../../packages/core/api-kit/src/error-codes.ts'
import { ServiceUnavailable } from '../../packages/core/api-kit/src/schema.ts'
import { commonErrorMessages } from '../../packages/web/i18n/src/format.ts'
import { manifestPath } from '../lib/manifest.ts'

class First extends Schema.TaggedError<First>()('EXTERNAL_CONFLICT', {}) {}
class Second extends Schema.TaggedError<Second>()('EXTERNAL_CONFLICT', {}) {}
const group = (id: string, error: Schema.Top) =>
  HttpApiGroup.make(id).add(HttpApiEndpoint.get('read', '/', { error }))

describe('assembled API error codes', () => {
  it('validates the selected assembly without a handwritten plugin list', async () => {
    const resolution = await currentResolution(manifestPath())
    const groups = [...resolution.descriptors].flatMap(([pluginId, descriptor]) =>
      Plugin.contributionsOf(descriptor, ApiGroups).map(({ group }) => ({ pluginId, group })),
    )
    expect(groups.length).toBeGreaterThan(0)
    expect(() => validateErrorCodes(groups)).not.toThrow()
  })
  it('allows a shared error declaration across endpoints', () => {
    expect(() =>
      validateErrorCodes([
        { pluginId: '@acme/a', group: group('a', First) },
        { pluginId: '@acme/b', group: group('b', First) },
      ]),
    ).not.toThrow()
  })
  it('refuses different declarations claiming the same code and names both owners', () => {
    expect(() =>
      validateErrorCodes([
        { pluginId: '@acme/a', group: group('a', First) },
        { pluginId: '@acme/b', group: group('b', Second) },
      ]),
    ).toThrow(/EXTERNAL_CONFLICT.*@acme\/a.*@acme\/b/)
  })
  it('keeps the platform code contract and presenters in agreement', () => {
    expect(Object.keys(commonErrorMessages).sort()).toEqual([...commonErrorCodes].sort())
  })
  it('reserves pipeline codes even when no endpoint declares them', () => {
    class Impostor extends Schema.TaggedError<Impostor>()('SERVICE_UNAVAILABLE', {}) {}
    expect(() =>
      validateErrorCodes([{ pluginId: '@acme/impostor', group: group('fake', Impostor) }]),
    ).toThrow(/SERVICE_UNAVAILABLE.*@qualy\/api-kit\/pipeline.*@acme\/impostor/)
    expect(() =>
      validateErrorCodes([
        { pluginId: '@acme/shared', group: group('shared', ServiceUnavailable) },
      ]),
    ).not.toThrow()
  })
})
