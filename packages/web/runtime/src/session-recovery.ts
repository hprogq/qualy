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
//
// A call is not the only way a page finds out. Coming back to the tab asks
// the manifest again, and the manifest never refuses: it answers as nobody.
// Taken as it is, that answer rebuilt the routes for a visitor, the page
// under the reader went, and the sign-in page came up in its place - with the
// recovery's question still pending over it. So a manifest that went from
// somebody to nobody is a session lost too, and goes to the same recovery:
// the page keeps being shown as the reader's until they are back, sign out,
// or turn out to be somebody else (`presentedManifest`).
//
// Somebody else is never carried on as. The server authorizes every call as
// whoever is signed in now, but it cannot know that the page making it was
// loaded, and filled in, for somebody who was signed in before - so a page
// that finds another identity signed in, whether or not a recovery was
// waiting, is locked for good: it keeps the manifest it had, sends nothing
// more (`frozen`), and offers only a reload. Signing in or out in one tab is
// told to the others, which ask the server who is signed in there and then.

export interface SessionRecovery {
  /**
   * Held until the reader decides: true once the same person is signed in
   * again and the call may be made again, false to fail it as refused.
   */
  readonly wait: (signal?: AbortSignal) => Promise<boolean>
  /**
   * The manifest answered as nobody, or as somebody else (`someoneElse`), for
   * a page signed in as `identity`: true when the recovery takes it (the page
   * keeps its manifest meanwhile), false when the page is to take the answer
   * as it is - the reader chose to sign out, or the page is changing identity
   * itself.
   */
  readonly lost: (identity: string, someoneElse: boolean) => boolean
  /** the page belongs to somebody no longer signed in: nothing it asks is sent */
  readonly frozen: () => boolean
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
  // left unanswered: a reload is the only way on from here
  if (installed?.frozen() === true) return new Promise<never>(() => {})
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

interface Viewed {
  readonly viewer: string
  readonly identity?: string | undefined
}

/**
 * The manifest the page is to be shown with, given the one it has and the one
 * just asked for: the new one, unless it is nobody's where the page was
 * somebody's and a recovery takes that - then the page keeps the one it has.
 */
export const presentedManifest = <M extends Viewed>(shown: M | undefined, asked: M): M => {
  if (
    shown?.viewer !== 'authenticated' ||
    shown.identity === undefined ||
    (asked.viewer === 'authenticated' && asked.identity === shown.identity) ||
    identityChanging()
  ) {
    return asked
  }
  const someoneElse = asked.viewer === 'authenticated'
  return installed?.lost(shown.identity, someoneElse) === true ? shown : asked
}

// The tab a reader signs in again on tells the others, which then ask the
// server who is signed in. Only a nudge: the message says nothing about who,
// and nothing is believed from it. A page that carries on says so back, and
// the sign-in tab closes on hearing it: by the time the reader is back on
// the page, it has already carried on, rather than doing so as they arrive -
// a lock that vanished the moment it was seen read as a glitch.
const SESSION_CHANNEL = 'qualy:session'

type SessionMessage =
  | { readonly type: 'signed-in' }
  | { readonly type: 'resumed' }
  | { readonly type: 'switched' }
  | { readonly type: 'changed' }

const isMessage = (data: unknown, type: SessionMessage['type']): boolean =>
  typeof data === 'object' && data !== null && (data as { type?: unknown }).type === type

/** the query a sign-in opened for a recovery carries, so it ends by saying so */
export const SESSION_RESUME_PARAM = 'resume'

/** what the page that waited made of a sign-in, as the tab that signed in hears it */
export type SignInOutcome = 'resumed' | 'switched' | 'unanswered' | 'unknown'

/**
 * Tells the other tabs that somebody signed in here, and waits up to
 * `waitMs` for the page that was waiting to answer: 'resumed' when it carried
 * on, 'switched' when it belonged to somebody else and cannot, 'unanswered'
 * when nothing answered (it is gone), and 'unknown' where the browser has no
 * channel to ask over.
 */
export const announceSignedIn = (waitMs: number): Promise<SignInOutcome> => {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve('unknown')
  const channel = new BroadcastChannel(SESSION_CHANNEL)
  return new Promise((resolve) => {
    const done = (answer: SignInOutcome) => {
      clearTimeout(timer)
      channel.close()
      resolve(answer)
    }
    const timer = setTimeout(() => done('unanswered'), waitMs)
    channel.onmessage = (event: MessageEvent) => {
      if (isMessage(event.data, 'resumed')) done('resumed')
      else if (isMessage(event.data, 'switched')) done('switched')
    }
    channel.postMessage({ type: 'signed-in' } satisfies SessionMessage)
  })
}

/** tells the tab that signed in whether this page carried on, or belongs to somebody else */
export const announceOutcome = (outcome: 'resumed' | 'switched') => {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(SESSION_CHANNEL)
  channel.postMessage({ type: outcome } satisfies SessionMessage)
  channel.close()
}

/** calls `heard` whenever another tab says somebody signed in; returns the way to stop */
export const onSignedInElsewhere = (heard: () => void): (() => void) => {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel(SESSION_CHANNEL)
  channel.onmessage = (event: MessageEvent) => {
    if (isMessage(event.data, 'signed-in')) heard()
  }
  return () => channel.close()
}

// One channel for this page's own telling and hearing: a channel does not
// hear what it said itself, so a page is not told of its own change.
let hints: BroadcastChannel | undefined
const hintChannel = () =>
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : (hints ??= new BroadcastChannel(SESSION_CHANNEL))

/** tells the other tabs that who is signed in has changed here */
export const announceSessionChanged = () => {
  hintChannel()?.postMessage({ type: 'changed' } satisfies SessionMessage)
}

/** calls `heard` whenever another tab signs in or out; returns the way to stop */
export const onSessionChangedElsewhere = (heard: () => void): (() => void) => {
  const channel = hintChannel()
  if (channel === undefined) return () => {}
  const listener = (event: MessageEvent) => {
    if (isMessage(event.data, 'changed') || isMessage(event.data, 'signed-in')) heard()
  }
  channel.addEventListener('message', listener)
  return () => channel.removeEventListener('message', listener)
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
