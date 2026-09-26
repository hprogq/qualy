import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { sharedContext } from './shared-context.ts'

// What the browser tab says while the page it names cannot be shown.
//
// The tab carries the page's name from the manifest, which is right while the
// page is there. A person who does not exist opened at their address still
// matches the person page, and a tab, a history entry or a bookmark called
// "Profile" for nobody tells the reader nothing when they come back to it. So
// a state standing where the page would have been says its own heading to the
// tab for as long as it stands there, and the page's name comes back with it.
//
// Claims stack rather than replace: two screens overlap for the length of a
// route change, and the one leaving must not take the arriving one's word
// with it.

interface TitleOverride {
  readonly title: string | null
  readonly claim: (title: string) => () => void
}

const Scope = sharedContext<TitleOverride | null>('document-title', null)

let claims = 0

/** mounted around the routes whose tab title it may override */
export function DocumentTitleScope({ children }: { children: ReactNode }) {
  const [held, setHeld] = useState<readonly { readonly id: number; readonly title: string }[]>([])
  // stable, so a claim never re-arms the claimant's own effect
  const claim = useCallback((title: string) => {
    claims += 1
    const id = claims
    setHeld((current) => [...current, { id, title }])
    return () => setHeld((current) => current.filter((entry) => entry.id !== id))
  }, [])
  const value = useMemo<TitleOverride>(
    () => ({ title: held.at(-1)?.title ?? null, claim }),
    [held, claim],
  )
  return <Scope.Provider value={value}>{children}</Scope.Provider>
}

/** what a state has said the tab should read instead of the page's name */
export function useDocumentTitleOverride(): string | null {
  return useContext(Scope)?.title ?? null
}

/** says `title` to the tab while it is not null; nothing where no scope listens */
export function useClaimDocumentTitle(title: string | null): void {
  const claim = useContext(Scope)?.claim
  useEffect(() => {
    if (claim === undefined || title === null) return
    return claim(title)
  }, [claim, title])
}
