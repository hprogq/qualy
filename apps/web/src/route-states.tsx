import { useEffect, useMemo } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Link } from 'react-router'
import {
  drawerSignOut,
  surfaceLabel,
  type BrowserSurface,
  type DrawerSignOutContext,
} from '@qualy/ui-contract'
import { Failure, UiSlot, useManifest, type RouteSlots } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { ResourceState } from '@qualy/ui/resource-state'
import { LoadingScreen, PageLoading } from '@qualy/ui/spinner'
import { webRelease } from './release.ts'

// What the host draws where the route tree has no page to show: a page or a
// shell still loading, a page's code that failed, an address that leads
// nowhere, and nothing to open at all. Every one of them is the same state
// a page draws for a record that is not there, with the ways out the host
// can offer.

const styles = stylex.create({
  // no shell around it: the state is the viewport
  standalone: {
    minHeight: '100dvh',
  },
})

/** told to the way out that it is a screen's one action, not the drawer's last word */
const STANDALONE: DrawerSignOutContext = { standalone: true }

/**
 * The route-level states, in the reader's language, for the home the
 * manifest resolved; rebuilt when the locale changes, so no fallback keeps
 * the previous language.
 */
export function useRouteSlots(homePath: string | undefined): RouteSlots {
  const { format } = useI18n()
  const manifest = useManifest()
  // With no shell there is no drawer, and so no way out of the session but
  // the one a screen offers itself: whoever owns sessions contributes it, and
  // a visitor who is not signed in has nothing to leave.
  const signedIn =
    manifest.viewer === 'authenticated' && (manifest.slots[drawerSignOut.key]?.length ?? 0) > 0
  return useMemo<RouteSlots>(() => {
    const signOut = signedIn
      ? [<UiSlot key="sign-out" token={drawerSignOut} context={STANDALONE} />]
      : []
    return {
      pageLoading: <PageLoading />,
      layoutLoading: <LoadingScreen />,
      // A page's code that failed is drawn as any page that cannot be shown
      // is: where the page would have been, with a retry and the way home.
      pageError: (retry) => (
        <Failure
          title={format(commonMessages.pageFailed)}
          description={format(commonMessages.loadFailedHint)}
          onRetry={retry}
          actions={homePath === undefined ? [] : [<HomeLink key="home" to={homePath} />]}
        />
      ),
      layoutError: (retry) => (
        <Failure
          title={format(commonMessages.layoutFailed)}
          description={format(commonMessages.loadFailedHint)}
          onRetry={retry}
          fullscreen
        />
      ),
      componentMissing: (surface) => (
        <MissingComponent surface={surface} title={format(commonMessages.componentMissing)} />
      ),
      // The way out of a mistyped address is the home the route builder
      // resolved - one resolution, the same one the origin redirects to - so
      // a viewer with any page to open is always offered it. One with none
      // has no home and no shell around the state either - a stale link, a
      // bookmark, a reload of a page since taken away - and is offered the
      // session's own way out, as on the screen the origin shows them. The
      // same state a page draws for a record that is not there, since an
      // address that leads nowhere is one.
      notFound: ({ homePath: home, standalone }) => (
        <ResourceState
          kind="missing"
          title={format(commonMessages.notFoundTitle)}
          description={format(commonMessages.notFoundHint)}
          actions={home === undefined ? signOut : [<HomeLink key="home" to={home} primary />]}
          {...(standalone ? { xstyle: styles.standalone } : {})}
        />
      ),
      // No page to open at all: there is no shell either, so this is the
      // screen, and its one way out is the session's own.
      empty: (
        <ResourceState
          kind="denied"
          title={format(commonMessages.emptyPagesTitle)}
          description={format(
            signedIn ? commonMessages.emptyPagesSignedInHint : commonMessages.emptyPagesHint,
          )}
          actions={signOut}
          xstyle={styles.standalone}
        />
      ),
    }
  }, [format, homePath, signedIn])
}

/** home, as a way out of a state that is not a page */
function HomeLink({ to, primary = false }: { to: string; primary?: boolean }) {
  const { format } = useI18n()
  return (
    <Button asChild variant={primary ? 'default' : 'outline'}>
      <Link to={to}>{format(commonMessages.goHome)}</Link>
    </Button>
  )
}

// a surface the manifest named is not in this bundle: the reader is told the
// page cannot open, and the console is told which surface and in which
// release - a fact for whoever ships the bundle, never for the screen
function MissingComponent({ surface, title }: { surface: BrowserSurface; title: string }) {
  const label = surfaceLabel(surface)
  useEffect(() => {
    console.error(`[qualy] missing from this build: ${label} (release ${webRelease.releaseId})`)
  }, [label])
  return <Failure title={title} />
}
