import { defineDomainErrors } from '@qualy/api-contract'

// Invariants that span identity and access: they are declared here, in the
// package both plugins already speak, because either side can violate them.
// Disabling a user is an auth operation; revoking their administrator role is
// an rbac one; both can leave a tenant unable to administer itself, and a
// tenant must never learn about that difference.
export const accessInvariantErrors = defineDomainErrors({
  LAST_ADMINISTRATOR: {
    status: 409,
    message: 'the tenant must keep an administrator who can still sign in',
  },
})
