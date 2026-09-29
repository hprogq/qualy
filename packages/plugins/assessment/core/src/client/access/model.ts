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

/**
 * Where a source is held, as a reader may be told it: a unit by name, the
 * whole institution, or a unit outside what the reader manages - which the
 * server leaves unnamed but still identifies.
 */
export const whereOf = (
  source: Pick<AccessSource, 'orgNodeId' | 'orgNodeName'>,
): { kind: 'unit'; name: string } | { kind: 'everywhere' } | { kind: 'beyond' } =>
  source.orgNodeId === null
    ? { kind: 'everywhere' }
    : source.orgNodeName === null
      ? { kind: 'beyond' }
      : { kind: 'unit', name: source.orgNodeName }

/**
 * What one of a person's roles gives them in this round: what it carries
 * that the round accepted, less what the round turned off for the person.
 *
 * The same sum the server makes (readAccess): a person's `effective` is
 * these, each role's in force, put together - so a page that shows them
 * role by role says exactly what the one line said, only which role says it.
 * A role that has lapsed carries nothing here and gives nothing.
 */
export const grantsOf = (
  source: Pick<AccessSource, 'current'>,
  denied: readonly string[],
): { inForce: string[]; turnedOff: string[] } => ({
  inForce: source.current.filter((code) => !denied.includes(code)),
  turnedOff: source.current.filter((code) => denied.includes(code)),
})
