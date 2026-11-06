'use client'
import { type ReactNode } from 'react'
import { primaryNavigation, type BrowserSurface } from '@qualy/ui-contract'
import { PluginComponentBoundary, useUiCollection } from '@qualy/web-runtime'
import { Suspense } from 'react'
import { useRouteSlots } from '../route-states.tsx'

// The host's frames for a route the server rendered
// (docs/adr/0012-rsc-data-mode.md): the same states, in the same words, the
// page-rendered routes draw - a surface's own boundary and suspense, the
// screen for a surface this build does not carry, for an address that leads
// nowhere, and for a viewer with no page at all.

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
      <Suspense fallback={layout ? slots.layoutLoading : slots.pageLoading}>{children}</Suspense>
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
