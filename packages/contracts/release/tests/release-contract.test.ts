import { describe, expect, it } from 'vitest'
import { CURRENT_CLIENT_PROTOCOL, isReleaseId, isReleaseProbe } from '../src/index.ts'
import {
  RELEASE_SCHEMA,
  parseInstalledWebRelease,
  parseWebBuildMetadata,
  parseWebReleaseIdentity,
  releaseProbeOf,
} from '../src/private.ts'

describe('release ids', () => {
  it('accepts the names a directory and a header both take without escaping', () => {
    for (const id of [
      'r_hT3kQ9vXbN2mPzR7wL4sYd',
      'local-20260914T090000Z-3f9a1c2d',
      'dev-8ab12c9f',
      'a',
      'A1',
      'v1.2.3_rc-4',
    ]) {
      expect(isReleaseId(id)).toBe(true)
    }
  })

  it('refuses anything that could name a path outside the store, or is not a name at all', () => {
    for (const id of [
      '',
      '.',
      '..',
      '.hidden',
      '-leading',
      'a/b',
      'a\\b',
      'a b',
      'a:b',
      'a?b',
      'z'.repeat(129),
      42,
      null,
      undefined,
    ]) {
      expect(isReleaseId(id)).toBe(false)
    }
    expect(isReleaseId('z'.repeat(128))).toBe(true)
  })
})

describe('release documents', () => {
  const identity = {
    schema: RELEASE_SCHEMA,
    releaseId: 'local-20260914T090000Z-3f9a1c2d',
    mode: 'production' as const,
    clientProtocol: CURRENT_CLIENT_PROTOCOL,
  }

  it('parses an identity and refuses one field at a time', () => {
    expect(parseWebReleaseIdentity(identity)).toEqual(identity)
    expect(() => parseWebReleaseIdentity({ ...identity, schema: 2 })).toThrow()
    expect(() => parseWebReleaseIdentity({ ...identity, releaseId: '../etc' })).toThrow()
    expect(() => parseWebReleaseIdentity({ ...identity, mode: 'test' })).toThrow()
    expect(() => parseWebReleaseIdentity({ ...identity, clientProtocol: 1.5 })).toThrow()
    expect(() => parseWebReleaseIdentity({ ...identity, clientProtocol: '1' })).toThrow()
    expect(() => parseWebReleaseIdentity(null)).toThrow()
    expect(() => parseWebReleaseIdentity('local-x')).toThrow()
  })

  it('parses an installed release with its assembly, time and asset list', () => {
    const installed = {
      ...identity,
      resolutionHash: 'sha256:abc',
      installedAt: '2026-09-14T09:00:00.000Z',
      assets: ['assets/index-AAA.js'],
    }
    expect(parseInstalledWebRelease(installed)).toEqual(installed)
    expect(() => parseInstalledWebRelease({ ...installed, installedAt: 'yesterday' })).toThrow()
    expect(() => parseInstalledWebRelease({ ...installed, assets: [''] })).toThrow()
    expect(() => parseInstalledWebRelease({ ...installed, resolutionHash: '' })).toThrow()
  })

  it('answers a probe carrying the release and nothing else, and reads one back as a guard', () => {
    const probe = releaseProbeOf(identity)
    expect(probe).toEqual({ schema: 2, releaseId: identity.releaseId })
    // the private identity's other fields are not the browser's business,
    // and the projection is what keeps them off the wire
    expect(Object.keys(probe).sort()).toEqual(['releaseId', 'schema'])
    expect(isReleaseProbe(probe)).toBe(true)
    expect(isReleaseProbe({ ...probe, releaseId: 'a/b' })).toBe(false)
    expect(isReleaseProbe(undefined)).toBe(false)
    expect(isReleaseProbe('B')).toBe(false)
  })

  it('refuses the probe the previous generation answered', () => {
    // a page of one generation reading the other's answer learns nothing
    // rather than mistaking it: an unreadable probe is a failed probe, and
    // a failed probe never reports an update
    expect(
      isReleaseProbe({
        schema: 1,
        releaseId: identity.releaseId,
        mode: 'production',
        clientProtocol: 1,
        serverProtocol: { min: 1, max: 1 },
      }),
    ).toBe(false)
  })

  it('parses build metadata with the revision the release id does not carry', () => {
    const revision = '3e01e6a2d9cbeda2581671b45727ef268861d564'
    expect(parseWebBuildMetadata({ ...identity, revision })).toEqual({ ...identity, revision })
    // it is optional: a build nobody told what it was built from is normal
    expect(parseWebBuildMetadata(identity)).toEqual(identity)
    expect(() => parseWebBuildMetadata({ ...identity, revision: '' })).toThrow()
    expect(() => parseWebBuildMetadata({ ...identity, revision: 'x'.repeat(201) })).toThrow()
  })
})
