import { Api } from '@qualy/api-kit/plugin'
import { authLocalApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call
export const authLocalApi = Api.local(authLocalApiGroup)
