import { useEffect, useMemo } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Link } from 'react-router'
import { surfaceLabel, type BrowserSurface } from '@qualy/ui-contract'
import { Failure, type RouteSlots } from '@qualy/web-runtime'
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

/**
 * The route-level states, in the reader's language, for the home the
 * manifest resolved; rebuilt when the locale changes, so no fallback keeps
 * the previous language.
 */
export function useRouteSlots(homePath: string | undefined): RouteSlots {
  const { format } = useI18n()
  return useMemo<RouteSlots>(
    () => ({
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
      // a viewer with any page to open is always offered it; one with none
      // has nowhere to be sent, and the shell's own header still offers
      // whatever the session allows. The same state a page draws for a
      // record that is not there, since an address that leads nowhere is one.
      notFound: ({ homePath: home, standalone }) => (
        <ResourceState
          kind="missing"
          title={format(commonMessages.notFoundTitle)}
          description={format(commonMessages.notFoundHint)}
          actions={home === undefined ? [] : [<HomeLink key="home" to={home} primary />]}
          {...(standalone ? { xstyle: styles.standalone } : {})}
        />
      ),
      // no page to open at all: there is no shell either, so this is the screen
      empty: (
        <ResourceState
          kind="denied"
          title={format(commonMessages.emptyPagesTitle)}
          description={format(commonMessages.emptyPagesHint)}
          xstyle={styles.standalone}
        />
      ),
    }),
    [format, homePath],
  )
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
