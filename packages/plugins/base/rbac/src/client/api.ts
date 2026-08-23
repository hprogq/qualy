import { Api } from '@qualy/api-kit/local'
import { accessApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call
export const accessApi = Api.local(accessApiGroup)
