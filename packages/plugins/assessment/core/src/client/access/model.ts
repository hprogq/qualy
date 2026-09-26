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

/**
 * What a person's standing in this round can still be adjusted over: every
 * capability one of their sources carries today, withheld or not.
 *
 * A capability withheld here that nothing offers any more is not in it:
 * turning it back on would give them nothing, and a box that does nothing
 * when ticked is a promise the round cannot keep.
 */
export const adjustableOf = (subject: Pick<AccessSubject, 'sources'>): string[] => [
  ...new Set(subject.sources.flatMap((source) => source.current)),
]
