import { z } from 'zod'
import { del, get, okOutput } from '@qualy/api-contract'

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

// The session is a resource, not a pair of verbs: reading it says who is
// signed in, deleting it signs them out. /auth/me and /auth/logout modelled
// the same thing two different ways and left no room for the per-device
// listing this will grow.
export const authContract = {
  listLoginMethods: get('/auth/login-methods').output(
    z.object({ methods: z.array(loginMethod) }),
  ),
  getSession: get('/auth/session')
    .errors({
      AUTH_REQUIRED: { status: 401, message: 'authentication required' },
      SESSION_EXPIRED: { status: 401, message: 'session expired' },
    })
    .output(z.object({ user: userDto })),
  endSession: del('/auth/session').output(okOutput),
}

// identity administration is the same plugin's second api surface, so it
// becomes its own client namespace rather than crowding the session core
export { identityContract } from './iam/contract.ts'
export type { IamUserDto, UserTypeDto } from './iam/contract.ts'
