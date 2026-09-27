import { useCallback } from 'react'
import { usePageQueryState, usePageQueryUpdate } from '@qualy/web-runtime'
import { ACCESS_STANDINGS } from '../../api.ts'
import { BATCH_STAFF_CODES } from '../../permissions.ts'

// Which of a round's staff the page is showing: the words searched for, the
// three narrowings and the page. In the address, so a reload keeps the
// question and a link to "who may review here" is a link.

/** people per page: each row is a person with every source behind them */
export const ACCESS_PAGE_SIZE = 25

export type AccessStandingFilter = (typeof ACCESS_STANDINGS)[number]
export type AccessPermissionFilter = (typeof BATCH_STAFF_CODES)[number]

export interface AccessView {
  readonly page: number
  readonly q: string
  readonly roleId: string
  readonly permission: '' | AccessPermissionFilter
  readonly standing: '' | AccessStandingFilter
}

const KEYS = {
  page: 'page',
  q: 'q',
  roleId: 'role',
  permission: 'permission',
  standing: 'standing',
} as const satisfies Record<keyof AccessView, string>

const oneOf = <T extends string>(allowed: readonly T[], value: string): '' | T =>
  (allowed as readonly string[]).includes(value) ? (value as T) : ''

// a role from a hand-edited address that is not an id at all is no filter,
// rather than a question the server refuses
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** the staff list as the address has it, and a way to move it */
export function useAccessView(): readonly [AccessView, (changes: Partial<AccessView>) => void] {
  const [page] = usePageQueryState(KEYS.page)
  const [q] = usePageQueryState(KEYS.q)
  const [roleId] = usePageQueryState(KEYS.roleId)
  const [permission] = usePageQueryState(KEYS.permission)
  const [standing] = usePageQueryState(KEYS.standing)
  const write = usePageQueryUpdate()
  const view: AccessView = {
    page: Math.max(1, Number.parseInt(page, 10) || 1),
    q,
    roleId: UUID.test(roleId) ? roleId : '',
    permission: oneOf(BATCH_STAFF_CODES, permission),
    standing: oneOf(ACCESS_STANDINGS, standing),
  }
  // Every key in one write: two address writes from one press race, and the
  // second drops the first. A different question starts at its first page.
  const move = useCallback(
    (changes: Partial<AccessView>) => {
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(changes) as [keyof AccessView, unknown][]) {
        const text = String(value ?? '')
        next[KEYS[key]] = key === 'page' && text === '1' ? '' : text
      }
      if (changes.page === undefined) next[KEYS.page] = ''
      write(next)
    },
    [write],
  )
  return [view, move] as const
}

// Sent here to appoint somebody - from a review step nobody holds - the
// address says as what and, where it knows, at which unit, and the page
// opens its add-staff dialog with both answered. Neither is trusted: the
// dialog drops a role or a unit that is not on offer.
const APPOINT = { role: 'appoint', unit: 'appoint-at' } as const
/** `appoint` with no particular role in mind */
const ANY_ROLE = 'any'

/**
 * The address of the staff page that opens its add-staff dialog at a seat:
 * give it as the `search` of a link to `assessment/batch-access`.
 */
export const appointSearch = (seat: {
  readonly roleId?: string
  readonly orgNodeId?: string
}): Record<string, string> => ({
  [APPOINT.role]: seat.roleId ?? ANY_ROLE,
  ...(seat.orgNodeId === undefined ? {} : { [APPOINT.unit]: seat.orgNodeId }),
})

/**
 * A seat the address asks to appoint at, or null; and a way to forget it
 * once the dialog it opened is closed, so a reload does not open it again.
 */
export function useAppointRequest(): readonly [
  { readonly roleId?: string; readonly orgNodeIds?: readonly string[] } | null,
  () => void,
] {
  const [role] = usePageQueryState(APPOINT.role)
  const [unit] = usePageQueryState(APPOINT.unit)
  const write = usePageQueryUpdate()
  const forget = useCallback(() => write({ [APPOINT.role]: '', [APPOINT.unit]: '' }), [write])
  if (role === '') return [null, forget] as const
  return [
    {
      ...(UUID.test(role) ? { roleId: role } : {}),
      ...(UUID.test(unit) ? { orgNodeIds: [unit] } : {}),
    },
    forget,
  ] as const
}

/** whether anything narrows the list, which is what an empty answer turns on */
export const narrowed = (view: AccessView) =>
  view.q.trim() !== '' || view.roleId !== '' || view.permission !== '' || view.standing !== ''

/** the question the staff endpoint is asked, for this view */
export const accessQueryOf = (view: AccessView) => ({
  page: String(view.page),
  limit: String(ACCESS_PAGE_SIZE),
  ...(view.q.trim() !== '' ? { q: view.q.trim() } : {}),
  ...(view.roleId !== '' ? { roleId: view.roleId } : {}),
  ...(view.permission !== '' ? { permission: view.permission } : {}),
  ...(view.standing !== '' ? { standing: view.standing } : {}),
})
