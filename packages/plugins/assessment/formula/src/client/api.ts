import { Api } from '@qualy/api-kit/local'
import { orgApiGroup } from '@qualy/plugin-org/api'
import { formulaApiGroup } from '../api.ts'

// this plugin's typed client surface: its own group, plus org's for the
// owner-node picker (the contract leaf is shared; no server code rides in)
export const formulaApi = Api.local(formulaApiGroup, orgApiGroup)
