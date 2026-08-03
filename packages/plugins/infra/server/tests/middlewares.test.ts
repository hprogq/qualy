import { oc } from '@orpc/contract'
import { call, implement } from '@orpc/server'
import { z } from 'zod'
import { defineDomainErrors, AccessDeniedError } from '@qualy/api-contract'
import { describe, expect, it } from 'vitest'
import { apiErrorBoundary, requireAuth, type ApiContext, type AuthPrincipal } from '../src/index.ts'

// the two middlewares every plugin router composes; they carry the whole
// api's error and identity behavior, so they are pinned here without a
// database or an http server in the way

const errors = defineDomainErrors({
  DECLARED: { status: 409, message: 'declared by the contract' },
  WITH_DATA: {
    status: 409,
    message: 'declared with data',
    data: z.object({ count: z.number().int() }),
  },
  UNDECLARED: { status: 409, message: 'never listed by this procedure' },
})

const contract = {
  run: oc
    .input(z.object({ mode: z.string() }))
    .errors(errors.pick('DECLARED', 'WITH_DATA'))
    .output(z.object({ user: z.string() })),
}

const impl = implement(contract).$context<ApiContext>().use(apiErrorBoundary).use(requireAuth)

const router = impl.router({
  run: impl.run.handler(({ context, input }) => {
    switch (input.mode) {
      case 'declared':
        throw errors.create('DECLARED')
      case 'declared-with-data':
        throw errors.create('WITH_DATA', { count: 4 })
      case 'undeclared':
        throw errors.create('UNDECLARED')
      case 'denied':
        throw new AccessDeniedError('nope')
      case 'boom':
        throw new Error('an ordinary bug')
      default:
        // requireAuth narrowed principal to non-optional for this handler
        return { user: context.principal.userId }
    }
  }),
})

const principal: AuthPrincipal = { tenantId: 't1', userId: 'u1', sessionId: 's1' }
const invoke = (mode: string, context: Partial<ApiContext> = { principal }) =>
  call(router.run, { mode }, { context: context as ApiContext })

describe('shared router middlewares', () => {
  it('passes the authenticated principal through to the handler', async () => {
    await expect(invoke('ok')).resolves.toEqual({ user: 'u1' })
  })

  it('rejects anonymous requests before the handler runs', async () => {
    await expect(invoke('ok', {})).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('maps a declared domain error onto the procedure typed error', async () => {
    await expect(invoke('declared')).rejects.toMatchObject({
      code: 'DECLARED',
      defined: true,
      message: 'declared by the contract',
    })
  })

  it('carries structured data through the mapping', async () => {
    await expect(invoke('declared-with-data')).rejects.toMatchObject({
      code: 'WITH_DATA',
      defined: true,
      data: { count: 4 },
    })
  })

  it('leaves a domain error this procedure never declared as an internal fault', async () => {
    // a code outside the contract must not be smuggled to the client as a
    // typed error; it stays an unhandled fault the handler logs
    const failure = await invoke('undeclared').catch((error: unknown) => error)
    expect((failure as { defined?: boolean }).defined).not.toBe(true)
    expect((failure as Error).message).toBe('never listed by this procedure')
  })

  it('turns an in-service access denial into the transport forbidden', async () => {
    await expect(invoke('denied')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('leaves ordinary failures untouched', async () => {
    await expect(invoke('boom')).rejects.toThrow('an ordinary bug')
  })
})
