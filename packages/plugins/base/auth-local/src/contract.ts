import { z } from 'zod'
import { post } from '@qualy/api-contract'
import { userDto } from '@qualy/plugin-auth/contract'
import { authLocalErrors } from './errors.ts'

// url shape is /auth/<provider-type>/<provider-code>/<operation>: the code
// selects one configured provider instance of the tenant
export const authLocalContract = {
  login: post('/auth/local/{providerCode}/login')
    .errors(authLocalErrors.pick('INVALID_CREDENTIALS'))
    .input(
      z.object({
        providerCode: z.string().min(1).max(63),
        identifier: z.string().min(1).max(255),
        password: z.string().min(1),
      }),
    )
    .output(z.object({ user: userDto })),
}
