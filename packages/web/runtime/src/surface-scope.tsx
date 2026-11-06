'use client'
import { useMemo, type ReactNode } from 'react'
import { withSurfaces, type HandedSurfaces } from './registry.ts'
import { RuntimeContext, useRuntime } from './runtime-context.tsx'

// Surfaces a server handed to one part of the page
// (docs/adr/0012-rsc-data-mode.md).
//
// A server rendering a document decides which surfaces it needs - a sign-in
// page the login drivers this deployment offers, a list the renderers its
// records name - and hands the browser references to exactly those. Below
// this they resolve the way every surface does, through `PluginSurface` and
// `UiSlot`; nothing above it can reach them, and nothing beyond them was
// ever sent.

export function SurfaceScope({
  surfaces,
  children,
}: {
  surfaces: HandedSurfaces
  children: ReactNode
}) {
  const runtime = useRuntime()
  const scoped = useMemo(
    () => ({ ...runtime, registry: withSurfaces(runtime.registry, surfaces) }),
    [runtime, surfaces],
  )
  return <RuntimeContext.Provider value={scoped}>{children}</RuntimeContext.Provider>
}
