import { useEffect, useRef, useState } from 'react'
import { notifyManager, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { NamespacedId } from '@qualy/ui-contract'
import { toast } from '@qualy/ui/toast'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { signingOut } from './identity.ts'
import { buildPageHref } from './pages.ts'
import type { Manifest } from './runtime-context.tsx'
import {
  announceOutcome,
  identityChanging,
  installSessionRecovery,
  onSessionChangedElsewhere,
  onSignedInElsewhere,
  SESSION_RESUME_PARAM,
} from './session-recovery.ts'
import { SessionRecoveryDialog, type SessionRecoveryState } from './session-recovery-dialog.tsx'

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
}: {
  manifestKey: QueryKey
  /** the manifest, asked directly: the question is who is signed in, never refused */
  askManifest: () => Promise<Manifest>
  /** where signing in happens; without it the page itself is opened, and sends there */
  signInPage?: NamespacedId | undefined
}) {
  const queryClient = useQueryClient()
  const { format } = useI18n()
  const [standing, setStanding] = useState<SessionRecoveryState | undefined>()
  const held = useRef<Held | undefined>(undefined)
  // the reader chose to sign out: answers as nobody are taken as they come
  const leaving = useRef(false)
  // somebody else is signed in: the page sends nothing more
  const frozen = useRef(false)

  useEffect(() => {
    const switched = () => {
      frozen.current = true
      setStanding('switched')
    }
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
          if (someoneElse) switched()
          return true
        }
        held.current = holding(identity)
        if (someoneElse) switched()
        else setStanding('expired')
        return true
      },
      frozen: () => frozen.current,
    })
    return () => {
      uninstall()
      held.current?.settle(false)
      held.current = undefined
      frozen.current = false
    }
  }, [queryClient, manifestKey])

  // Another tab signed in or out: who is signed in here is asked at once,
  // rather than when the reader next comes back to this tab. The answer goes
  // through the manifest like any other, and to the recovery from there.
  useEffect(
    () =>
      onSessionChangedElsewhere(() => {
        if (frozen.current || leaving.current || identityChanging()) return
        void queryClient.refetchQueries({ queryKey: manifestKey, exact: true })
      }),
    [queryClient, manifestKey],
  )

  // every state but the last is still waiting for the same reader
  const waiting = standing !== undefined && standing !== 'switched'
  useEffect(() => {
    if (!waiting) return
    let stopped = false
    /** whether the reader is back; says so to the page when they are, or when somebody else is */
    const ask = async () => {
      const current = held.current
      if (current === undefined || stopped) return
      let manifest: Manifest
      try {
        manifest = await askManifest()
      } catch {
        return
      }
      if (stopped || held.current !== current || manifest.viewer !== 'authenticated') return
      if (manifest.identity !== current.identity) {
        frozen.current = true
        setStanding('switched')
        // the tab that signed in is theirs, and need not wait to hear it
        announceOutcome('switched')
        return
      }
      queryClient.setQueryData(manifestKey, manifest)
      held.current = undefined
      setStanding(undefined)
      current.settle(true)
      // the sign-in tab closes on hearing it, and the reader learns why the
      // lock went: quietly, without anything left to dismiss
      announceOutcome('resumed')
      toast.success(format(commonMessages.sessionResumed))
    }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void ask()
    }, ASK_EVERY_MS)
    const returned = () => {
      if (document.visibilityState === 'visible') void ask()
    }
    document.addEventListener('visibilitychange', returned)
    window.addEventListener('focus', returned)
    const unhear = onSignedInElsewhere(() => void ask())
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', returned)
      window.removeEventListener('focus', returned)
      unhear()
    }
  }, [waiting, askManifest, queryClient, manifestKey, format])

  /** the sign-in page, told it is there for a recovery */
  const signInHref = (() => {
    const pages = queryClient.getQueryData<Manifest>(manifestKey)?.pages ?? []
    const entry =
      signInPage === undefined ? undefined : pages.find((page) => page.id === signInPage)
    return entry === undefined
      ? window.location.href
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
    void (async () => {
      try {
        await queryClient.cancelQueries()
        const manifestHash = queryClient
          .getQueryCache()
          .find({ queryKey: manifestKey, exact: true })?.queryHash
        notifyManager.batch(() => {
          for (const query of queryClient.getQueryCache().getAll()) {
            if (query.queryHash !== manifestHash) query.reset()
          }
        })
        // answered as nobody, and taken: the routes send the visitor to sign in
        await queryClient.refetchQueries({ queryKey: manifestKey, exact: true })
      } finally {
        leaving.current = false
      }
    })()
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
