import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'

interface BandFoot {
  node: ReactNode
  /** a band saying it has drawn them, so the shell does not draw them too */
  claim: () => () => void
}

const BandFoot = createContext<BandFoot | null>(null)

/**
 * The shell saying what belongs under the words of whatever band is drawn
 * beneath it.
 *
 * The sections of the open application are the reader's, not the page's, so
 * no page can be asked to draw them - and a bar of its own above the page's
 * name puts them where nobody is looking. The shell hands them down; each
 * band draws them at its foot, and says so. Nothing here knows what they
 * are, and a page with no band of its own leaves them to the shell.
 */
export function BandFootScope({
  value,
  onClaim,
  children,
}: {
  value: ReactNode
  /** told when a band takes them, and when the band that took them goes */
  onClaim?: (taken: boolean) => void
  children: ReactNode
}) {
  const held = useRef(0)
  const claim = useCallback(() => {
    held.current += 1
    onClaim?.(true)
    return () => {
      held.current -= 1
      if (held.current === 0) onClaim?.(false)
    }
  }, [onClaim])
  const value_ = useMemo(() => ({ node: value, claim }), [value, claim])
  return <BandFoot value={value_}>{children}</BandFoot>
}

/**
 * What the shell hung under this band, and the band saying it took it.
 *
 * For a page that draws its own masthead rather than using `Screen`: the
 * sections of the open application still belong under its words, and the
 * shell still needs telling that somebody has drawn them.
 */
export function useBandFoot(): ReactNode {
  const foot = useContext(BandFoot)
  const claim = foot?.claim
  useLayoutEffect(() => claim?.(), [claim])
  return foot?.node ?? null
}

/**
 * Holding the sections for a page that is still on its way.
 *
 * Until the page's code has arrived nobody knows whether it draws a band, and
 * a shell that drew the sections itself in the meantime drew them at the top
 * of the page, then moved them under the band the moment the page arrived.
 * The page's stand-in holds them instead: nothing is drawn until the page
 * says where they go.
 */
export function useBandFootHold(): void {
  const claim = useContext(BandFoot)?.claim
  useLayoutEffect(() => claim?.(), [claim])
}
