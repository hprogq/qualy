import { Api } from '@qualy/api-kit/local'
import { directoryApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call
export const directoryApi = Api.local(directoryApiGroup)
