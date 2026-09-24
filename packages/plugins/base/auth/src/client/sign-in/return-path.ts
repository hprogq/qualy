import { safeReturnPath } from '@qualy/ui-contract/return-path'

// The way back to where somebody was when they were sent to sign in.

const SENTINEL = 'https://qualy.invalid'

/** the address to return to, when the one asked for is one here and not the sign-in page itself */
export const returnPathFrom = (params: URLSearchParams, here: string): string | undefined => {
  const path = safeReturnPath(params.get('next'))
  if (path === undefined) return undefined
  // /login?next=/login?next=... leads nowhere but here again
  return new URL(path, SENTINEL).pathname === here ? undefined : path
}

/**
 * Where a way in that leaves this application starts, told where to come
 * back to. The flow it starts keeps the path and returns there once the
 * other side has vouched for the person.
 */
export const startHref = (href: string, next: string | undefined): string => {
  const target = new URL(href, SENTINEL)
  if (next !== undefined) target.searchParams.set('returnTo', next)
  return `${target.pathname}${target.search}${target.hash}`
}
