import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { z } from 'zod'
import { userDto } from '@qualy/plugin-auth/contract'

// url shape is /auth/<provider-type>/<provider-code>/<operation>: the code
// selects one configured provider instance of the tenant
export const authLocalErrorStatuses = {
  INVALID_CREDENTIALS: 401,
} as const

export const authLocalContract = {
  login: oc
    .meta(openapi({ method: 'POST', path: '/auth/local/{providerCode}/login' }))
    .errors({ INVALID_CREDENTIALS: { status: 401, message: 'invalid credentials' } })
    .input(
      z.object({
        providerCode: z.string().min(1).max(63),
        identifier: z.string().min(1).max(255),
        password: z.string().min(1),
      }),
    )
    .output(z.object({ user: userDto })),
}
