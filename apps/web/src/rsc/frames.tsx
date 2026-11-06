'use client'
import { type ReactNode } from 'react'
import { primaryNavigation, type BrowserSurface } from '@qualy/ui-contract'
import { PluginComponentBoundary, useUiCollection } from '@qualy/web-runtime'
import { useRouteSlots } from '../route-states.tsx'

// The host's frames for a route the server rendered
// (docs/adr/0012-rsc-data-mode.md): the same states, in the same words, the
// page-rendered routes draw - a surface's own error boundary, the screen for
// a surface this build does not carry, for an address that leads nowhere,
// and for a viewer with no page at all.
//
// No loading state. The page a server draws arrives whole: the html waits
// for what the first screen shows rather than sending a loading screen to
// be replaced, and a navigation keeps the page being left until the next
// one is ready, as the page-rendered router does while a page's code loads.
// A boundary here would undo both - streamed first, its wordmark was the
// screen a reader saw before every document, and mounted with a new page it
// was shown again on every navigation.

const useSlots = () => {
  const navigation = useUiCollection(primaryNavigation)
  const home = navigation.find((item) => item.target.kind === 'page')
  return useRouteSlots(home?.target.kind === 'page' ? home.target.path : undefined)
}

export function Surface({ surface, children }: { surface: BrowserSurface; children: ReactNode }) {
  const slots = useSlots()
  const layout = surface.kind === 'layout'
  return (
    <PluginComponentBoundary
      surface={surface}
      fallback={layout ? slots.layoutError : slots.pageError}
    >
      {children}
    </PluginComponentBoundary>
  )
}

export function Missing({ surface }: { surface: BrowserSurface }) {
  return <>{useSlots().componentMissing(surface)}</>
}

export function NotFound({ homePath, standalone }: { homePath?: string; standalone: boolean }) {
  return <>{useSlots().notFound({ ...(homePath === undefined ? {} : { homePath }), standalone })}</>
}

export function Empty() {
  return <>{useSlots().empty}</>
}
