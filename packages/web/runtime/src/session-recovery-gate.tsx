import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { ConfirmDialog } from '@qualy/ui/admin'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@qualy/ui/alert-dialog'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import type { Manifest } from './runtime-context.tsx'
import { identityChanging, installSessionRecovery } from './session-recovery.ts'

// The page's side of a session lost from under its reader (session-recovery.ts).
//
// Calls that were refused are held here. The reader is asked to sign in again
// in a new tab - this one keeps its page, and whatever they had typed on it -
// and the page asks now and then, and whenever it comes back into view,
// whether somebody is signed in. The same person: the calls are made again and
// the page carries on. Somebody else: the page can only start over as them, so
// it says so and offers nothing but a reload - carrying on would send what one
// person typed as another.

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
  /** who the page was working for when the calls were refused */
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

export function SessionRecoveryGate({
  manifestKey,
  askManifest,
}: {
  manifestKey: QueryKey
  /** the manifest, asked directly: the question is who is signed in, never refused */
  askManifest: () => Promise<Manifest>
}) {
  const queryClient = useQueryClient()
  const { format } = useI18n()
  // held: calls are waiting and the reader put the question away; asking: the
  // question is on screen; someone-else: another account signed in meanwhile
  const [standing, setStanding] = useState<'held' | 'asking' | 'someone-else' | undefined>()
  const held = useRef<Held | undefined>(undefined)

  useEffect(() => {
    const release = (again: boolean) => {
      const current = held.current
      held.current = undefined
      setStanding(undefined)
      current?.settle(again)
    }
    const uninstall = installSessionRecovery({
      wait: (signal) => {
        if (identityChanging()) return Promise.resolve(false)
        const current = held.current
        if (current !== undefined) {
          // another call found out: bring the question back if it was put away
          setStanding((now) => (now === 'held' ? 'asking' : now))
          return unlessAborted(current.promise, signal)
        }
        const manifest = queryClient.getQueryData<Manifest>(manifestKey)
        if (manifest?.viewer !== 'authenticated' || manifest.identity === undefined) {
          return Promise.resolve(false)
        }
        let settle!: (again: boolean) => void
        const promise = new Promise<boolean>((resolve) => {
          settle = resolve
        })
        const mine: Held = { identity: manifest.identity, promise, settle }
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
          } else setStanding('asking')
        }, GRACE_MS)
        return unlessAborted(promise, signal)
      },
    })
    return () => {
      uninstall()
      held.current?.settle(false)
      held.current = undefined
    }
  }, [queryClient, manifestKey])

  const waiting = standing === 'held' || standing === 'asking'
  useEffect(() => {
    if (!waiting) return
    let stopped = false
    /** whether the reader is back; says so to the page when they are, or when somebody else is */
    const ask = async (): Promise<boolean> => {
      const current = held.current
      if (current === undefined || stopped) return false
      let manifest: Manifest
      try {
        manifest = await askManifest()
      } catch {
        return false
      }
      if (stopped || held.current !== current || manifest.viewer !== 'authenticated') return false
      if (manifest.identity !== current.identity) {
        setStanding('someone-else')
        return false
      }
      queryClient.setQueryData(manifestKey, manifest)
      held.current = undefined
      setStanding(undefined)
      current.settle(true)
      return true
    }
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void ask()
    }, ASK_EVERY_MS)
    // coming back from the tab they signed in on is the likeliest moment,
    // and one that has not signed in yet is asked the question again
    const returned = () => {
      if (document.visibilityState !== 'visible') return
      void ask().then((back) => {
        if (!back) setStanding((now) => (now === 'held' ? 'asking' : now))
      })
    }
    document.addEventListener('visibilitychange', returned)
    window.addEventListener('focus', returned)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', returned)
      window.removeEventListener('focus', returned)
    }
  }, [waiting, askManifest, queryClient, manifestKey])

  return (
    <>
      <ConfirmDialog
        open={standing === 'asking'}
        title={format(commonMessages.sessionLostTitle)}
        description={format(commonMessages.sessionLostHint)}
        confirmLabel={format(commonMessages.sessionSignIn)}
        otherLabel={format(commonMessages.sessionSignOut)}
        cancelLabel={format(commonMessages.sessionLater)}
        onConfirm={() => {
          // the page itself, fresh: signed out, it goes to sign in and comes back
          window.open(window.location.href, '_blank', 'noopener')
          setStanding('held')
        }}
        onOther={() => {
          // the calls fail as refused, and the page's usual answer to a lost
          // identity sends the reader to sign in
          const current = held.current
          held.current = undefined
          setStanding(undefined)
          current?.settle(false)
        }}
        onCancel={() => setStanding((now) => (now === 'asking' ? 'held' : now))}
      />
      <AlertDialog open={standing === 'someone-else'}>
        <AlertDialogContent data-testid="session-switched">
          <AlertDialogHeader>
            <AlertDialogTitle>{format(commonMessages.sessionSwitchedTitle)}</AlertDialogTitle>
            <AlertDialogDescription>
              {format(commonMessages.sessionSwitchedHint)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => window.location.reload()}>
              {format(commonMessages.sessionReload)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
