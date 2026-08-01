import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { z } from 'zod'

const userDto = z.object({
  id: z.string(),
  displayName: z.string(),
  businessNo: z.string().nullable(),
  userType: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  primaryOrgNode: z.object({ id: z.string(), code: z.string().nullable(), name: z.string() }),
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
})

export type UserDto = z.infer<typeof userDto>

// http statuses for these codes are registered through server.contribute
// (beta.21 maps status per code via the handler's errorStatusMap; the status
// field below documents intent and types the client)
export const authErrorStatuses = {
  INVALID_CREDENTIALS: 401,
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
} as const

export const authContract = {
  loginLocal: oc
    .meta(openapi({ method: 'POST', path: '/auth/local/login' }))
    .errors({ INVALID_CREDENTIALS: { status: 401, message: 'invalid credentials' } })
    .input(z.object({ identifier: z.string().min(1).max(255), password: z.string().min(1) }))
    .output(z.object({ user: userDto })),
  logout: oc
    .meta(openapi({ method: 'POST', path: '/auth/logout' }))
    .output(z.object({ ok: z.boolean() })),
  me: oc
    .meta(openapi({ method: 'GET', path: '/auth/me' }))
    .errors({
      AUTH_REQUIRED: { status: 401, message: 'authentication required' },
      SESSION_EXPIRED: { status: 401, message: 'session expired' },
    })
    .output(z.object({ user: userDto })),
}
