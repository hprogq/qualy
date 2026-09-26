import { useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { Portal } from '@qualy/ui/portal'
import { sharedContext } from './shared-context.ts'

// The thing a shell is drawn around, gone.
//
// A shell around one record - a batch, a person - draws the record's name in
// a band and its sections in a rail, and every page under it is a part of
// that record. When the record is not there, not the reader's, or could not
// be read at all, none of that has anything to stand for: a rail of sections
// of nothing and a band with a name that never arrives only make the one
// sentence that matters harder to find.
//
// So whoever reads the record - the plugin filling the shell's band - says
// so, and hands over what to show instead. The shell folds everything bound
// to the record away, keeps the product's own bar as the way out, and seats
// the state where the page would have been. The shell never learns what the
// record is or why it is gone; the owner never learns what the shell folds.
//
// The owner is itself inside the band it would fold, so the band is hidden,
// never unmounted: an owner taken off the screen would withdraw its word,
// the shell would unfold, the owner would come back and say it again.
//
// Absent is the exception, so nothing is folded until somebody says so -
// the opposite of the capability scope, which waits for a word before it
// shows anything. Counted like the other claims: two screens overlap for
// the length of a route change.

interface SubjectScopeValue {
  readonly holders: number
  readonly seat: HTMLElement | null
  readonly claim: (holding: boolean) => void
  readonly setSeat: (node: HTMLElement | null) => void
}

const Scope = sharedContext<SubjectScopeValue | null>('subject', null)

/** mounted by a shell drawn around one record, around its band and its pages */
export function SubjectScope({ children }: { children: ReactNode }) {
  const [holders, setHolders] = useState(0)
  const [seat, setSeat] = useState<HTMLElement | null>(null)
  // stable, so a claim never re-arms the claimant's own effect
  const claim = useCallback(
    (holding: boolean) => setHolders((count) => Math.max(0, count + (holding ? 1 : -1))),
    [],
  )
  const value = useMemo<SubjectScopeValue>(
    () => ({ holders, seat, claim, setSeat }),
    [holders, seat, claim],
  )
  return <Scope.Provider value={value}>{children}</Scope.Provider>
}

/**
 * For the shell: whether the record it is drawn around is absent, and where
 * to seat what its owner shows instead. While `absent`, the shell draws an
 * element with `seat` as its ref where its pages would have been, and folds
 * away what is bound to the record, keeping the band mounted but hidden.
 */
export function useSubjectAbsenceSeat(): {
  readonly absent: boolean
  readonly seat: (node: HTMLElement | null) => void
} {
  const scope = useContext(Scope)
  return { absent: (scope?.holders ?? 0) > 0, seat: scope?.setSeat ?? noSeat }
}

const noSeat = () => {}

/**
 * Said by whoever reads the record a shell is drawn around, while it is
 * absent: its children - usually a `LoadFailure` of page size - are what the
 * reader sees instead of the record's pages. Outside a shell that folds for
 * it, the children are drawn where this stands.
 *
 * Claimed before the browser paints, so the rail and the page never show
 * for a frame after the owner has learned there is nothing to show.
 */
export function SubjectAbsence({ children }: { children: ReactNode }) {
  const scope = useContext(Scope)
  const claim = scope?.claim
  useLayoutEffect(() => {
    if (claim === undefined) return
    claim(true)
    return () => claim(false)
  }, [claim])
  if (scope === null) return <>{children}</>
  return <Portal into={scope.seat}>{children}</Portal>
}
