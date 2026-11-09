import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { NamespacedId } from '@qualy/ui-contract'
import { toast } from '@qualy/ui/toast'

import { signingOut } from './identity.ts'
import { buildPageHref } from '../routing/pages.ts'
import type { Manifest } from '../runtime-context.tsx'
import {
  announceOutcome,
  answerAsWaiting,
  identityChanging,
  installSessionRecovery,
  onSessionChangedElsewhere,
  onSignedInElsewhere,
  presentedManifest,
  SESSION_RESUME_PARAM,
} from './session-recovery.ts'
import { SessionRecoveryDialog, type SessionRecoveryState } from './session-recovery-dialog.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'

// The page's side of a session lost from under its reader (session-recovery.ts).
//
// The page is locked, not taken away: it stays mounted with whatever was typed
// on it, and a dialog that cannot be dismissed stands over it - there is
// nothing to do on a page without a session but sign in again or leave. Signing
// in happens on the sign-in page in a tab of its own (every way in, the ones
// that leave for another site included, works there as it always does), and
// the dialog stays, saying it is waiting, so coming back before signing in
// shows the same wait rather than the first question again. The page learns
// the reader is back from that tab (a nudge over BroadcastChannel), on coming
// back into view, and every few seconds - and in each case asks the server,
// never the nudge. The same person: the held calls are made again and the page
// carries on. Somebody else: the page can only start over as them. Signing out
// instead: the page lets go, and the sign-in page takes its place.
//
// Somebody else can also turn up with nothing waiting - signed out and in
// again in another tab, which tells this one, or found when the reader comes
// back to it. The page is locked the same way, straight to the reload: from
// then on it sends nothing, since whatever it sent would go as the new
// identity with what the page holds from the old one.

/** how often a page waiting for its reader asks whether they are back */
const ASK_EVERY_MS = 3_000

/** A recent server answer is enough for a routine window focus. */
const RETURN_FRESH_MS = 15_000

/**
 * How long a refused call waits before the reader is asked anything.
 *
 * Signing out refuses the calls still in flight as well, and the transition
 * that follows is what says it was on purpose; this is the moment it has to
 * say so in.
 */
const GRACE_MS = 300

interface Held {
  /** who the page was working for when the session went */
  readonly identity: string
  readonly promise: Promise<boolean>
  readonly settle: (again: boolean) => void
}

/** a wait that gives up when the call it holds is cancelled */
const unlessAborted = (waiting: Promise<boolean>, signal: AbortSignal | undefined) =>
  signal === undefined
    ? waiting
    : new Promise<boolean>((resolve) => {
        if (signal.aborted) return resolve(false)
        signal.addEventListener('abort', () => resolve(false), { once: true })
        void waiting.then(resolve)
      })

const holding = (identity: string): Held => {
  let settle!: (again: boolean) => void
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve
  })
  return { identity, promise, settle }
}

export function SessionRecoveryGate({
  manifestKey,
  askManifest,
  signInPage,
  onFreeze,
  onLeave,
}: {
  manifestKey: QueryKey
  /** the manifest, asked directly: the question is who is signed in, never refused */
  askManifest: () => Promise<Manifest>
  /** where signing in happens; without it the page itself is opened, and sends there */
  signInPage?: NamespacedId | undefined
  onFreeze: () => void
  onLeave: () => void
}) {
  const queryClient = useQueryClient()

  const [standing, setStanding] = useState<SessionRecoveryState | undefined>()
  const held = useRef<Held | undefined>(undefined)
  // the reader chose to sign out: answers as nobody are taken as they come
  const leaving = useRef(false)
  // somebody else is signed in: the page sends nothing more
  const frozen = useRef(false)
  const freeze = useCallback(() => {
    frozen.current = true
    onFreeze()
    setStanding('switched')
  }, [onFreeze])

  useEffect(() => {
    const release = (again: boolean) => {
      const current = held.current
      held.current = undefined
      setStanding(undefined)
      current?.settle(again)
    }
    const uninstall = installSessionRecovery({
      wait: (signal) => {
        if (identityChanging() || leaving.current) return Promise.resolve(false)
        const current = held.current
        // another call found out: it joins the wait, which says nothing new
        if (current !== undefined) return unlessAborted(current.promise, signal)
        const manifest = queryClient.getQueryData<Manifest>(manifestKey)
        if (manifest?.viewer !== 'authenticated' || manifest.identity === undefined) {
          return Promise.resolve(false)
        }
        const mine = holding(manifest.identity)
        held.current = mine
        setTimeout(() => {
          if (held.current !== mine) return
          // a change of identity that has begun, or has already finished
          // (the manifest in hand is somebody else's, or nobody's), was the
          // reason the calls were refused
          const now = queryClient.getQueryData<Manifest>(manifestKey)
          if (
            identityChanging() ||
            now?.viewer !== 'authenticated' ||
            now.identity !== mine.identity
          ) {
            release(false)
          } else setStanding((was) => was ?? 'expired')
        }, GRACE_MS)
        return unlessAborted(mine.promise, signal)
      },
      lost: (identity, someoneElse) => {
        if (identityChanging() || leaving.current) return false
        const current = held.current
        if (current !== undefined) {
          if (current.identity !== identity) return false
          if (someoneElse) freeze()
          return true
        }
        held.current = holding(identity)
        if (someoneElse) freeze()
        else setStanding('expired')
        return true
      },
      frozen: () => frozen.current,
      changed: () => {
        if (frozen.current) return
        freeze()
      },
    })
    return () => {
      uninstall()
      held.current?.settle(false)
      held.current = undefined
      frozen.current = false
    }
  }, [queryClient, manifestKey, freeze])

  const returnProbe = useRef<() => void>(() => {})
  // Focus and visibility can fire together. Reuse the rendered answer when
  // it is fresh and share one request with active recovery when it is not.
  useEffect(() => {
    let stopped = false
    let checking = false
    let checkAgain = false
    let verifiedAt = 0
    const unchanged = () => !stopped && !frozen.current && !leaving.current && !identityChanging()
    const probe = (explicit = false) => {
      if (!unchanged()) return
      const pending = held.current
      const snapshot = queryClient.getQueryState<Manifest>(manifestKey)
      if (snapshot?.data?.viewer !== 'authenticated') return
      const before = snapshot.data
      if (
        !explicit &&
        pending === undefined &&
        Date.now() - Math.max(verifiedAt, snapshot.dataUpdatedAt) < RETURN_FRESH_MS
      )
        return
      if (checking) {
        // An explicit cross-tab change can postdate the request in flight.
        checkAgain ||= explicit
        return
      }
      checking = true
      void askManifest()
        .then((after) => {
          if (!unchanged() || checkAgain || pending !== held.current) return
          if (queryClient.getQueryData<Manifest>(manifestKey)?.identity !== before.identity) return
          if (pending === undefined) {
            if (after.viewer === 'authenticated' && after.identity === before.identity)
              verifiedAt = Date.now()
            // Check identity; do not replace the rendered surface projection.
            presentedManifest(before, after)
            return
          }
          if (after.viewer !== 'authenticated') return
          if (after.identity !== pending.identity) {
            freeze()
            announceOutcome('switched')
            return
          }
          queryClient.setQueryData(manifestKey, after)
          held.current = undefined
          setStanding(undefined)
          pending.settle(true)
          announceOutcome('resumed')
          toast.success(commonMessages.session_resumed())
        })
        .catch(() => {})
        .finally(() => {
          checking = false
          if (!checkAgain) return
          checkAgain = false
          probe(true)
        })
    }
    const returned = () => {
      if (document.visibilityState === 'visible') probe()
    }
    returnProbe.current = returned
    const unhearChange = onSessionChangedElsewhere(() => probe(true))
    const unhearSignIn = onSignedInElsewhere(() => {
      if (held.current !== undefined) probe(true)
    })
    window.addEventListener('focus', returned)
    document.addEventListener('visibilitychange', returned)
    return () => {
      stopped = true
      unhearChange()
      unhearSignIn()
      window.removeEventListener('focus', returned)
      document.removeEventListener('visibilitychange', returned)
      returnProbe.current = () => {}
    }
  }, [askManifest, freeze, manifestKey, queryClient])

  const waiting = standing !== undefined && standing !== 'switched'
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => returnProbe.current(), ASK_EVERY_MS)
    // A sign-in tab learns there is a page to tell.
    const unanswer = answerAsWaiting()
    return () => {
      unanswer()
      clearInterval(timer)
    }
  }, [waiting])

  /** the sign-in page, told it is there for a recovery */
  const signInHref = (() => {
    const pages = queryClient.getQueryData<Manifest>(manifestKey)?.pages ?? []
    const entry =
      signInPage === undefined ? undefined : pages.find((page) => page.id === signInPage)
    // where this page is, when the sign-in page is not one it may name; a
    // server drawing the page has no address of its own to give, and the
    // dialog it is for is never open then
    return entry === undefined
      ? (globalThis.location?.href ?? '')
      : buildPageHref(entry, { search: { [SESSION_RESUME_PARAM]: '1' } })
  })()

  /**
   * Opens it in a tab of its own. Without `noopener`, which makes `open`
   * answer null whatever happened, so a tab the browser blocked can be told
   * from one it opened; the new tab is then cut loose from this one by hand.
   */
  const openSignIn = () => {
    const opened = window.open(signInHref, '_blank')
    if (opened === null) {
      setStanding('blocked')
      return
    }
    opened.opener = null
    setStanding('waiting')
  }

  /** the reader leaves: what the page held fails, and it becomes a visitor's */
  const signOut = () => {
    leaving.current = true
    const current = held.current
    held.current = undefined
    setStanding(undefined)
    current?.settle(false)
    // nothing the reader was shown stays readable, as after signing out
    signingOut()
    onLeave()
  }

  return (
    <SessionRecoveryDialog
      state={standing}
      signInHref={signInHref}
      onSignIn={openSignIn}
      onOpenedYourself={() => setStanding('waiting')}
      onSignOut={signOut}
      onReload={() => window.location.reload()}
    />
  )
}
