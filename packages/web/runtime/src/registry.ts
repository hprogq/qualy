import type { ComponentType, LazyExoticComponent } from 'react'
import type { BrowserSurface } from '@qualy/ui-contract'

// Every renderer this build carries, addressed the way the manifest names it.
//
// Four tables because there are four address spaces: a page id, a layout
// contract, an item's id under its slot, a login driver's type. It was one
// flat table keyed by `<plugin>/<SourceFile>`, which meant the server had to
// put that string on the wire for anything to be resolvable - so the product
// shipped its own package layout to every visitor, and two plugins with a
// component of the same name collided over nothing.
//
// Its own module rather than part of the runtime's entry: the component
// boundary resolves surfaces and the entry renders screens, and having the
// one import the other put a stylesheet-compiling module in the way of a
// route test that draws nothing.

/** a lazy component that can be fetched ahead of its first render */
export type RegisteredComponent = LazyExoticComponent<ComponentType<any>> & {
  preload?: () => Promise<void>
}

/**
 * Heterogeneous by design: each page or renderer declares its own props, and
 * consumers pass whatever the target expects.
 */
export interface ComponentRegistry {
  readonly pages: Readonly<Record<string, RegisteredComponent>>
  readonly layouts: Readonly<Record<string, RegisteredComponent>>
  readonly slots: Readonly<Record<string, Readonly<Record<string, RegisteredComponent>>>>
  readonly login: Readonly<Record<string, RegisteredComponent>>
}

/** a registry with nothing in it, for a test that renders one screen directly */
export const emptyComponentRegistry = (): ComponentRegistry => ({
  pages: {},
  layouts: {},
  slots: {},
  login: {},
})

/**
 * The renderer for one surface, or nothing when this build does not carry it.
 *
 * The single place an address becomes a component. A caller states which
 * surface it means - `{kind: 'page', id}` - rather than a string whose
 * meaning depends on which table it came from.
 */
export const resolveSurface = (
  registry: ComponentRegistry,
  surface: BrowserSurface,
): RegisteredComponent | undefined => {
  switch (surface.kind) {
    case 'page':
      return registry.pages[surface.id]
    case 'layout':
      return registry.layouts[surface.id]
    case 'slot':
      return registry.slots[surface.slot]?.[surface.id]
    case 'login':
      return registry.login[surface.id]
  }
}
