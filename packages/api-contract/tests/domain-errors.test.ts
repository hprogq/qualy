import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  AccessDeniedError,
  defineDomainErrors,
  isAccessDeniedError,
  isDomainError,
} from '../src/index.ts'

// the dsl is the single error source every plugin builds on; these tests pin
// its runtime behavior and (via @ts-expect-error) its compile-time strictness

// what an error built by another copy of this package looks like: only the
// brand and the shape, since the constructor is not exported
const brandedError = (code: string, data?: unknown) =>
  Object.assign(new Error('from elsewhere'), {
    [Symbol.for('qualy.api.domain-error')]: true,
    code,
    data,
  })

const errors = defineDomainErrors({
  THING_NOT_FOUND: { status: 404, message: 'thing not found' },
  THING_BLOCKED: {
    status: 409,
    message: 'thing is blocked',
    data: z.object({ blockerCount: z.number().int() }),
  },
})

describe('defineDomainErrors', () => {
  it('picks literal contract subsets', () => {
    const picked = errors.pick('THING_NOT_FOUND')
    expect(Object.keys(picked)).toEqual(['THING_NOT_FOUND'])
    expect(picked.THING_NOT_FOUND.status).toBe(404)
    // @ts-expect-error a code outside the definitions cannot be picked
    errors.pick('THING_TOTALLY_MADE_UP')
  })

  it('creates typed errors with definition-driven arguments', () => {
    const plain = errors.create('THING_NOT_FOUND')
    expect(isDomainError(plain)).toBe(true)
    expect(plain.code).toBe('THING_NOT_FOUND')
    expect(plain.message).toBe('thing not found')
    expect(plain.data).toBeUndefined()

    const contextual = errors.create('THING_NOT_FOUND', 'parent thing not found')
    expect(contextual.message).toBe('parent thing not found')

    const withData = errors.create('THING_BLOCKED', { blockerCount: 3 })
    expect(withData.data).toEqual({ blockerCount: 3 })
    expect(withData.message).toBe('thing is blocked')

    // @ts-expect-error a code that declares data must be given it
    errors.create('THING_BLOCKED')
    // @ts-expect-error the data must match the schema's shape
    errors.create('THING_BLOCKED', { wrongField: 3 })
    // @ts-expect-error a dataless code takes a message, not a data object
    errors.create('THING_NOT_FOUND', { blockerCount: 1 })
  })

  it('recognizes only its own errors, and only own properties', () => {
    expect(errors.is(errors.create('THING_NOT_FOUND'))).toBe(true)
    expect(errors.is(brandedError('OTHER_DOMAIN_CODE'))).toBe(false)
    expect(errors.is(new AccessDeniedError())).toBe(false)
    expect(errors.is(new Error('plain'))).toBe(false)
    // a prototype key is not a declared code
    expect(errors.is(brandedError('constructor'))).toBe(false)
    expect(errors.is(brandedError('toString'))).toBe(false)
  })

  it('recognizes errors from another copy of this package', () => {
    // a plugin resolving its own instance of the dsl still produces errors
    // the server boundary must map: recognition rides a global symbol, not
    // instanceof against one module graph
    const foreign = brandedError('THING_NOT_FOUND')
    expect(isDomainError(foreign)).toBe(true)
    expect(errors.is(foreign)).toBe(true)
    const deniedElsewhere = Object.assign(new Error('nope'), {
      [Symbol.for('qualy.api.access-denied')]: true,
    })
    expect(isAccessDeniedError(deniedElsewhere)).toBe(true)
    // a plain object with the same shape is not an error
    expect(isDomainError({ code: 'THING_NOT_FOUND' })).toBe(false)
  })

  it('rejects malformed declarations when the plugin loads', () => {
    expect(() => defineDomainErrors({ badCode: { status: 404, message: 'x' } })).toThrow(
      'SCREAMING_SNAKE_CASE',
    )
    expect(() => defineDomainErrors({ BAD: { status: 200, message: 'x' } })).toThrow('status')
    expect(() => defineDomainErrors({ BAD: { status: 404.5, message: 'x' } })).toThrow('status')
    expect(() => defineDomainErrors({ BAD: { status: 404, message: '  ' } })).toThrow('blank')
    // neither the table nor an individual definition can be mutated
    expect(() => {
      ;(errors.definitions as Record<string, unknown>).EXTRA = {}
    }).toThrow()
    expect(() => {
      ;(errors.definitions.THING_NOT_FOUND as { status: number }).status = 500
    }).toThrow()
  })
})
