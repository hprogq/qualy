import { Api } from '@qualy/api-kit/plugin'
import { orgApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call
export const orgApi = Api.local(orgApiGroup)
