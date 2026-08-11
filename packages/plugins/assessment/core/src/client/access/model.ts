import type { ApiResult } from '@qualy/web-runtime/api'
import type { assessmentApi } from '../api.ts'

/** one person, everything this round accepted about them, and what it withholds */
export type AccessSubject = ApiResult<
  typeof assessmentApi,
  'assessment',
  'listAccess'
>['staff'][number]

export type AccessSource = AccessSubject['sources'][number]

/** one difference between the organization and this batch, as a page carries it */
export type AccessChange = ApiResult<
  typeof assessmentApi,
  'assessment',
  'previewAccessSync'
>['items'][number]

/** which of them to take, and how much of each */
export interface AccessSelection {
  accept: { kind: 'new' | 'widened'; id: string; permissions: readonly string[] }[]
}
