import { Api } from '@qualy/api-kit/local'
import { formulaApiGroup } from '../api.ts'

// this plugin's typed client surface: its own group only - the owner picker
// asks this plugin's own owner-options endpoint, so no neighbour contract
// rides into the bundle
export const formulaApi = Api.local(formulaApiGroup)
