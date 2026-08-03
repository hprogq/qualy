import { implement } from '@orpc/server'
import type { Context } from 'cordis'
import type { ApiContext } from '@qualy/plugin-server'
import { authLocalContract } from './contract.ts'
import { normalizeLocalIdentifier, timingEqualizerHash, verifyPassword } from './password.ts'

export const name = 'auth-local'
export const inject = ['auth', 'server']

// password authentication driver: proves the user against a local provider
// instance, then hands the proof to the auth core for session creation.
// Every failure between provider resolution and verification answers one
// uniform INVALID_CREDENTIALS; unknown identifiers still burn one argon2
// verification so timing does not reveal account existence.
export function apply(ctx: Context) {
  ctx.auth.registerProviderType({
    type: 'local',
    describe: () => ({ mode: 'component', component: 'auth-local/LoginMethod' }),
  })

  const impl = implement(authLocalContract).$context<ApiContext>()
  ctx.server.contribute(
    'authLocal',
    impl.router({
      login: impl.login.handler(async ({ input, context, errors }) => {
        const fail = async (): Promise<never> => {
          await verifyPassword(timingEqualizerHash, input.password)
          throw errors.INVALID_CREDENTIALS()
        }
        const resolved = await ctx.auth.resolveProvider({
          providerCode: input.providerCode,
          expectedType: 'local',
        })
        if (!resolved) return fail()
        const identifier = normalizeLocalIdentifier(input.identifier)
        if (!identifier) return fail()
        const identity = await ctx.auth.findIdentity({
          tenantId: resolved.tenant.id,
          providerId: resolved.provider.id,
          identifier,
        })
        if (!identity?.credentialHash) return fail()
        const verified = await verifyPassword(identity.credentialHash, input.password)
        if (!verified) throw errors.INVALID_CREDENTIALS()
        if (!identity.user.userType.allowLocalLogin) throw errors.INVALID_CREDENTIALS()
        const user = await ctx.auth.completeLogin(context, {
          tenantId: resolved.tenant.id,
          userId: identity.userId,
          identityId: identity.id,
        })
        if (!user) throw errors.INVALID_CREDENTIALS()
        return { user }
      }),
    }),
  )
}
