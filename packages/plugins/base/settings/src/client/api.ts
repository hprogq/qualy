import { Api } from '@qualy/api-kit/local'
import { settingsApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call
export const settingsApi = Api.local(settingsApiGroup)
