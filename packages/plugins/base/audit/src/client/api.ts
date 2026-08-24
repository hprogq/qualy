import { Api } from '@qualy/api-kit/local'
import { auditApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call
export const auditApi = Api.local(auditApiGroup)
