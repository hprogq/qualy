import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { AccessDeniedError, defineDomainErrors, DomainError } from '../src/index.ts'

// the dsl is the single error source every plugin builds on; these tests pin
// its runtime behavior and (via @ts-expect-error) its compile-time strictness

const errors = defineDomainErrors({
  THING_NOT_FOUND: { status: 404, message: 'thing not found' },
  THING_BLOCKED: {
    status: 409,
    message: 'thing is blocked',
    data: z.object({ blockerCount: z.number().int() }),
  },
})

describe('defineDomainErrors', () => {
  it('derives statuses and picks literal contract subsets', () => {
    expect(errors.statuses).toEqual({ THING_NOT_FOUND: 404, THING_BLOCKED: 409 })
    const picked = errors.pick('THING_NOT_FOUND')
    expect(Object.keys(picked)).toEqual(['THING_NOT_FOUND'])
    expect(picked.THING_NOT_FOUND.status).toBe(404)
    // @ts-expect-error a code outside the definitions cannot be picked
    errors.pick('THING_TOTALLY_MADE_UP')
  })

  it('creates typed errors with definition-driven arguments', () => {
    const plain = errors.create('THING_NOT_FOUND')
    expect(plain).toBeInstanceOf(DomainError)
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

  it('recognizes only its own errors', () => {
    expect(errors.is(errors.create('THING_NOT_FOUND'))).toBe(true)
    expect(errors.is(new DomainError('OTHER_DOMAIN_CODE', 'x', undefined))).toBe(false)
    expect(errors.is(new AccessDeniedError())).toBe(false)
    expect(errors.is(new Error('plain'))).toBe(false)
  })
})
