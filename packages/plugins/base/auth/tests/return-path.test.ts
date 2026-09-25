import { describe, expect, it } from 'vitest'
import { safeReturnPath } from '@qualy/ui-contract/return-path'
import { returnPathFrom, startHref } from '../src/client/sign-in/return-path.ts'

// The way back to where somebody was before signing in: kept when it is an
// address here, dropped otherwise, and handed to a way in that leaves.

const asked = (next: string) => returnPathFrom(new URLSearchParams({ next }), '/login')

describe('the way back after signing in', () => {
  it('is an address inside this application, with its query and fragment', () => {
    expect(asked('/assessment/batches?open=1#row-3')).toBe('/assessment/batches?open=1#row-3')
  })

  it('is dropped when it leads anywhere else, or back to the sign-in page', () => {
    for (const next of [
      'https://elsewhere.example/',
      '//elsewhere.example/',
      '/\\elsewhere.example/',
      'javascript:alert(1)',
      'relative/path',
      '/login',
      '/login?next=/login',
      `/${'x'.repeat(2049)}`,
    ]) {
      expect(asked(next), next).toBeUndefined()
    }
    expect(returnPathFrom(new URLSearchParams(), '/login')).toBeUndefined()
  })

  it('is judged as a browser resolves it, dot segments and all', () => {
    for (const next of [
      '/.//elsewhere.example/',
      '/%2e//elsewhere.example/',
      '/a/..//elsewhere.example/x?y=1',
      '/./\\elsewhere.example/',
      '/..//elsewhere.example',
    ]) {
      expect(safeReturnPath(next), next).toBeUndefined()
    }
    // what it keeps is already resolved, so keeping it again changes nothing
    for (const next of [
      '/assessment/batches?open=1#row-3',
      '/a/../reports',
      '/./x//y',
      '/%2e/reports',
    ]) {
      const kept = safeReturnPath(next)
      expect(kept, next).toBeDefined()
      expect(safeReturnPath(kept), next).toBe(kept)
    }
  })

  it('travels with a way in that leaves, as the flow’s own returnTo', () => {
    expect(startHref('/api/auth/cas/campus/start', '/reports?a=1')).toBe(
      '/api/auth/cas/campus/start?returnTo=%2Freports%3Fa%3D1',
    )
    expect(startHref('/api/auth/oidc/sso/start?prompt=login', undefined)).toBe(
      '/api/auth/oidc/sso/start?prompt=login',
    )
  })
})
