import type { Exit } from 'effect'
import { settle } from '@qualy/web-rsc/queries'

// What the sign-in page's server render makes of its two reads
// (LoginPage.server.tsx), by how each ended (@qualy/web-rsc/queries): an
// answer is passed on as one; a server that could not be asked leaves the
// page undecided; a reader who left ends the render; anything else is a bug
// and is thrown.

/** whether somebody is signed in, or undecided when the server could not say */
export const presenceOf = (exit: Exit.Exit<unknown, unknown>): boolean | undefined => {
  const read = settle(exit)
  if (read.kind === 'answer') return true
  if (read.kind === 'unanswered') return undefined
  // the session middleware's own answers: nobody, or a session that lapsed
  const tag = (read.error as { _tag?: unknown })._tag
  if (tag === 'AUTH_REQUIRED' || tag === 'SESSION_EXPIRED') return false
  throw read.error
}

/** the workspace's ways in, or nothing when the server could not say */
export const methodsOf = <A>(exit: Exit.Exit<A, unknown>): A | undefined => {
  const read = settle(exit)
  if (read.kind === 'answer') return read.value
  if (read.kind === 'unanswered') return undefined
  throw read.error
}
