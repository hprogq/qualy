import { HttpApiClient } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/local'
import { accessApiGroup } from '@qualy/plugin-rbac/api'
import { identityApiGroup, loginIconApiGroup, selfApiGroup, sessionApiGroup } from '../api.ts'

// This plugin's typed client surface: its own groups plus the one neighbour
// contract its screens call - the user screens grant roles, which is rbac's
// api. Importing the GROUP is the whole point of the contract leaf: the
// client types come from the neighbour's schema without a runtime edge.
export const authApi = Api.local(
  identityApiGroup,
  sessionApiGroup,
  selfApiGroup,
  loginIconApiGroup,
  accessApiGroup,
)

// the same contract where an address is needed rather than a call: a door's
// uploaded icon is an <img src>
export const authUrls = HttpApiClient.urlBuilder(authApi)
