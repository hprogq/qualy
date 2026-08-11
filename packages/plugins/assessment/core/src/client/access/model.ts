import type { ApiResult } from '@qualy/web-runtime/api'
import type { assessmentApi } from '../api.ts'

/** one person, everything this round accepted about them, and what it withholds */
export type AccessSubject = ApiResult<
  typeof assessmentApi,
  'assessment',
  'listAccess'
>['staff'][number]

export type AccessSource = AccessSubject['sources'][number]
