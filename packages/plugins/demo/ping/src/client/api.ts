import { Api } from '@qualy/api-kit/local'
import { pingApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call
export const pingApi = Api.local(pingApiGroup)
