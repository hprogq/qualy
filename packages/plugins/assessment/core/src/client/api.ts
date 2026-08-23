import { Api } from '@qualy/api-kit/local'
import { assessmentApiGroup } from '../api.ts'

// this plugin's typed client surface: exactly the groups its screens call
export const assessmentApi = Api.local(assessmentApiGroup)
