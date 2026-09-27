import { isAuthenticationError } from '@qualy/web-i18n'

// What a call does when it finds the session gone.
//
// A session ends while a page is open: it went unused past the deployment's
// idle limit, ran out, or was ended from elsewhere. Whatever the page asks
// next is refused, and the page used to take that as the end - every answer
// dropped, the reader sent to sign in, and whatever they had typed gone with
// the page they typed it in.
//
// A page whose reader was signed in holds the call instead, asks them to sign
// in again (in another tab, so this page and its unsaved work stay where they
// are), and once the same person is back makes the call again: the same
// effect, run a second time. That is safe because a refused call never
// reached its handler - the session is checked before anything else runs.
// Somebody else signing in, or the reader choosing to sign out, ends the wait:
// the call fails the way it would have, and the page's usual response to a
// lost identity takes over.

export interface SessionRecovery {
  /**
   * Held until the reader decides: true once the same person is signed in
   * again and the call may be made again, false to fail it as refused.
   */
  readonly wait: (signal?: AbortSignal) => Promise<boolean>
}

let installed: SessionRecovery | undefined

/** the page's answer to a lost session, for as long as the returned function is not called */
export const installSessionRecovery = (recovery: SessionRecovery): (() => void) => {
  installed = recovery
  return () => {
    if (installed === recovery) installed = undefined
  }
}

/**
 * A call that found the session gone, made once more when it is back.
 *
 * Any other failure, a call cancelled while it waited, and a page with no
 * recovery installed (a harness, a visitor who was never signed in) fail as
 * they would have.
 */
export const recovering = async <A>(call: () => Promise<A>, signal?: AbortSignal): Promise<A> => {
  try {
    return await call()
  } catch (error) {
    // read afresh each time: the call may be cancelled while it waits
    const cancelled = () => signal?.aborted === true
    const recovery = installed
    if (recovery === undefined || !isAuthenticationError(error) || cancelled()) throw error
    if (!(await recovery.wait(signal)) || cancelled()) throw error
    return call()
  }
}

// A change of identity the page is making on purpose - signing out, signing
// in - refuses calls on the way too, and none of them is a session lost from
// under the reader. Counted, since two transitions can overlap.
let changing = 0

/** the page is changing who is signed in; calls refused meanwhile are not to be recovered */
export const changingIdentity = (): (() => void) => {
  changing += 1
  let done = false
  return () => {
    if (done) return
    done = true
    changing -= 1
  }
}

export const identityChanging = (): boolean => changing > 0
