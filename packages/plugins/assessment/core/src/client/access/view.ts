import { useCallback } from 'react'
import { usePageQueryState, usePageQueryUpdate } from '@qualy/web-runtime'
import { KEYS, UUID, accessViewOf, type AccessView } from './access-place.ts'

export {
  ACCESS_PAGE_SIZE,
  accessQueryOf,
  type AccessPermissionFilter,
  type AccessStandingFilter,
  type AccessView,
} from './access-place.ts'

// Which of a round's staff the page is showing, kept in the address
// (access-place.ts), so a reload keeps the question and a link to "who may
// review here" is a link.

/** the staff list as the address has it, and a way to move it */
export function useAccessView(): readonly [AccessView, (changes: Partial<AccessView>) => void] {
  const [page] = usePageQueryState(KEYS.page)
  const [q] = usePageQueryState(KEYS.q)
  const [roleId] = usePageQueryState(KEYS.roleId)
  const [permission] = usePageQueryState(KEYS.permission)
  const [standing] = usePageQueryState(KEYS.standing)
  const write = usePageQueryUpdate()
  const given: Record<string, string> = {
    [KEYS.page]: page,
    [KEYS.q]: q,
    [KEYS.roleId]: roleId,
    [KEYS.permission]: permission,
    [KEYS.standing]: standing,
  }
  const view = accessViewOf((key) => given[key] ?? '')
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
  /** the role to appoint as; none when the seat could be filled by several */
  readonly roleId?: string | null | undefined
  /** the unit to appoint at; none when it is not one unit */
  readonly orgNodeId?: string | null | undefined
}): Record<string, string> => ({
  [APPOINT.role]: seat.roleId ?? ANY_ROLE,
  ...(seat.orgNodeId === undefined || seat.orgNodeId === null
    ? {}
    : { [APPOINT.unit]: seat.orgNodeId }),
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
