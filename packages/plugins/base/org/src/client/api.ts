import { Api } from '@qualy/api-kit/local'
import { identityApiGroup } from '@qualy/plugin-auth/api'
import { orgApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call.
// The identity group is here for one read - how many people stand at a unit -
// and every call to it is allowed to fail: an organization administrator who
// cannot read users gets a screen without headcounts rather than no screen.
export const orgApi = Api.local(orgApiGroup, identityApiGroup)
