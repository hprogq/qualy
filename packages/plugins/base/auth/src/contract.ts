import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { z } from 'zod'

export const userDto = z.object({
  id: z.string(),
  displayName: z.string(),
  businessNo: z.string().nullable(),
  userType: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  primaryOrgNode: z.object({ id: z.string(), code: z.string().nullable(), name: z.string() }),
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
})

export type UserDto = z.infer<typeof userDto>

// public descriptor of one tenant login method (an auth_providers row whose
// driver plugin is active); the driver owns the presentation: either an
// embedded renderer component or a same-origin redirect target. Never
// exposes config or internal ids.
const loginMethodBase = { code: z.string(), type: z.string(), name: z.string() }
const loginMethod = z.discriminatedUnion('mode', [
  z.object({ ...loginMethodBase, mode: z.literal('component'), component: z.string() }),
  z.object({ ...loginMethodBase, mode: z.literal('redirect'), href: z.string() }),
])

export type LoginMethod = z.infer<typeof loginMethod>
export type ComponentLoginMethod = Extract<LoginMethod, { mode: 'component' }>

// props every embedded credential renderer receives from the login shell
export interface LoginMethodRendererProps {
  method: ComponentLoginMethod
  onAuthenticated: () => void
}

// http statuses for these codes are registered through server.contribute
// (beta.21 maps status per code via the handler's errorStatusMap; the status
// field below documents intent and types the client)
export const authErrorStatuses = {
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
} as const

export const authContract = {
  methods: oc
    .meta(openapi({ method: 'GET', path: '/auth/methods' }))
    .output(z.object({ methods: z.array(loginMethod) })),
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
