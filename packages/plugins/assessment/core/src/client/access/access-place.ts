import { ACCESS_STANDINGS } from '../../api.ts'
import { BATCH_STAFF_CODES } from '../../permission-codes.ts'

// Which of a round's staff the page is showing, as the address says it: the
// words searched for, the three narrowings and the page. Read by the page as
// it is open and by the server drawing it, which must ask the same question.

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

export const KEYS = {
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
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** the staff list the address names, read through `get` */
export const accessViewOf = (get: (key: string) => string): AccessView => ({
  page: Math.max(1, Number.parseInt(get(KEYS.page), 10) || 1),
  q: get(KEYS.q),
  roleId: UUID.test(get(KEYS.roleId)) ? get(KEYS.roleId) : '',
  permission: oneOf(BATCH_STAFF_CODES, get(KEYS.permission)),
  standing: oneOf(ACCESS_STANDINGS, get(KEYS.standing)),
})

/** the question the staff endpoint is asked, for this view */
export const accessQueryOf = (view: AccessView) => ({
  page: String(view.page),
  limit: String(ACCESS_PAGE_SIZE),
  ...(view.q.trim() !== '' ? { q: view.q.trim() } : {}),
  ...(view.roleId !== '' ? { roleId: view.roleId } : {}),
  ...(view.permission !== '' ? { permission: view.permission } : {}),
  ...(view.standing !== '' ? { standing: view.standing } : {}),
})
