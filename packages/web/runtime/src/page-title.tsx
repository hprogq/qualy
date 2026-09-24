import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { sharedContext } from './shared-context.ts'

// What the screen currently open calls itself, and where it says so.
//
// A narrow shell has no room for a page heading and a bar of tabs at once,
// so the heading stays in the page and the bar carries the brand. Once the
// heading has scrolled away the bar takes it over, which is the only moment
// the shell needs to know a page's name. The page says its name and hands
// over the element it wrote it in; the shell decides whether to draw it and
// watches that element itself.
//
// The element travels rather than a scroll position, because "has the
// heading gone" is a question about two boxes and the shell already answers
// that kind of question with an observer. A page that says nothing leaves
// the shell showing the brand alone, which is what every page did before.

interface TitleScope {
  readonly title: string | null
  /** the heading itself, for whoever wants to know when it has gone */
  readonly node: HTMLElement | null
  readonly claim: (title: string | null, node: HTMLElement | null) => void
}

const Scope = sharedContext<TitleScope | null>('page-title', null)

/** mounted by the shell, around whatever it renders screens into */
export function PageTitleScope({ children }: { children: ReactNode }) {
  const [held, setHeld] = useState<{ title: string | null; node: HTMLElement | null }>({
    title: null,
    node: null,
  })
  // stable, so claiming never re-arms the claimant's own effect
  const claim = useCallback(
    (title: string | null, node: HTMLElement | null) => setHeld({ title, node }),
    [],
  )
  const value = useMemo<TitleScope>(
    () => ({ title: held.title, node: held.node, claim }),
    [held, claim],
  )
  return <Scope.Provider value={value}>{children}</Scope.Provider>
}

/** the open screen's name and heading; both null wherever no page said one */
export function usePageTitleClaim(): { title: string | null; node: HTMLElement | null } {
  const scope = useContext(Scope)
  return { title: scope?.title ?? null, node: scope?.node ?? null }
}

/**
 * Says what this screen is called, and takes the heading that says it.
 *
 * Returns a ref to put on the heading. A shell that offers nowhere to
 * repeat it ignores both, so a page may always say its name.
 */
export function usePageTitle(title: string): (node: HTMLElement | null) => void {
  const claim = useContext(Scope)?.claim
  const [node, setNode] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (claim === undefined) return
    claim(title, node)
    return () => claim(null, null)
  }, [claim, title, node])
  return setNode
}
