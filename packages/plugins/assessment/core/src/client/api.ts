import { HttpApiClient } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/local'
import { assessmentApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call
export const assessmentApi = Api.local(assessmentApiGroup)

// The same contract, for the few places that need an address rather than a
// call: an <img src> for attachment bytes, a sendBeacon on the way out of the
// page. The prefix is the local api's and the parameters go through the
// endpoint's own schema, so a renamed route or parameter is a compile error
// instead of a stale string.
export const assessmentUrls = HttpApiClient.urlBuilder(assessmentApi)
