import { Context, Effect, Layer } from 'effect'
import {
  isVisibleTo,
  primaryNavigation,
  type NavigationItem,
  type ResolvedNavigationItem,
  type UiSurfaces,
  type UiVisibility,
  type ViewerAccess,
} from '@qualy/ui-contract'
import type { Principal } from '@qualy/rbac-contract'
import { UiAuthorizer } from './authorizer.ts'

// The manifest is an authorized projection.
//
// One authorizer lookup per request decides which surfaces the viewer may
// DISCOVER. Hiding a page is never authorization, since every api call is
// authorized on its own, but a viewer must not learn that a capability, its
// route or its component even exists. Internal declarations, visibility and
// permission codes among them, never leave.

/** the surfaces this assembly serves, resolved from the manifest */
export class UiCatalog extends Context.Service<UiCatalog, readonly UiSurfaces[]>()(
  '@qualy/plugin-ui-registry/UiCatalog',
) {}

export interface ManifestLayout {
  readonly contract: string
  readonly provider: string
  readonly component: string
}

export interface ManifestPage {
  readonly id: string
  readonly path: string
  readonly component: string
  readonly layout: string
}

export interface Manifest {
  readonly layouts: readonly ManifestLayout[]
  readonly pages: readonly ManifestPage[]
  readonly collections: Readonly<Record<string, readonly unknown[]>>
  readonly slots: Readonly<Record<string, readonly { id: string; component: string; order: number }[]>>
}

const sorted = <T extends { order?: number; id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id))

export const make = Effect.fn('Ui.manifest.make')(function* () {
  const catalog = yield* UiCatalog

  const pages = catalog.flatMap((surface) => surface.pages ?? [])
  const layouts = catalog.flatMap((surface) => surface.layouts ?? [])
  const slots = catalog.flatMap((surface) => surface.slots ?? [])
  // a page's navigation entry is sugar for a collection item that inherits the
  // page's visibility, so the two cannot drift into disagreeing about who may
  // see them
  const collections = [
    ...catalog.flatMap((surface) => surface.collections ?? []),
    ...pages
      .filter((page) => page.navigation)
      .map((page) => ({
        key: primaryNavigation.key,
        id: page.page.id,
        value: {
          id: page.page.id,
          label: page.navigation!.label,
          target: { kind: 'page' as const, pageId: page.page.id },
          icon: page.navigation!.icon,
          order: page.navigation!.order,
        } satisfies NavigationItem,
        visibility: page.visibility,
        order: page.navigation!.order,
      })),
  ]

  const byContract = new Map(layouts.map((layout) => [layout.contract, layout]))
  const visible = (visibility: UiVisibility, viewer: ViewerAccess) =>
    isVisibleTo(visibility, viewer)

  /**
   * One authorizer call covers every permission-gated surface of a request.
   *
   * An org-scope permission held at any anchor makes its page discoverable,
   * and that page's own api still decides which nodes the viewer may touch.
   */
  const viewerAccess = Effect.fn('Ui.manifest.viewer')(function* (principal?: Principal) {
    if (!principal) return { authenticated: false, permissions: new Set<string>() }
    // Read per request rather than captured at construction. Capturing it
    // would make this layer need the authorizer built first, and a merged
    // layer graph does not wire that: whoever provides it would have to be
    // named as a dependency here, which is backwards. As a per-request
    // requirement it travels to the top, where the whole assembly is composed.
    const authorizer = yield* UiAuthorizer
    return { authenticated: true, permissions: yield* authorizer.permissionsFor(principal) }
  })

  return {
    build: Effect.fn('Ui.manifest.build')(function* (principal?: Principal) {
      const viewer = yield* viewerAccess(principal)

      const shown = pages.filter((page) => {
        if (!visible(page.visibility, viewer)) return false
        if (byContract.has(page.layout)) return true
        return false
      })
      const dropped = pages.filter(
        (page) => visible(page.visibility, viewer) && !byContract.has(page.layout),
      )
      for (const page of dropped) {
        yield* Effect.logWarning(
          `page ${page.page.id} dropped: no provider for layout ${page.layout}`,
        )
      }
      const shownById = new Map(shown.map((page) => [page.page.id, page]))

      const projectedCollections: Record<string, unknown[]> = {}
      for (const item of sorted(collections.filter((item) => visible(item.visibility, viewer)))) {
        let value = item.value
        if (item.key === primaryNavigation.key) {
          const navigation = value as NavigationItem
          if (navigation.target.kind === 'page') {
            // a page target resolves to the path the router mounts, and drops
            // out entirely when the viewer cannot see that page
            const page = shownById.get(navigation.target.pageId)
            if (!page) continue
            value = {
              ...navigation,
              target: { kind: 'page', pageId: page.page.id, path: page.page.path },
            } satisfies ResolvedNavigationItem
          }
        }
        ;(projectedCollections[item.key] ??= []).push(value)
      }

      const projectedSlots: Record<string, { id: string; component: string; order: number }[]> = {}
      for (const slot of sorted(slots.filter((slot) => visible(slot.visibility, viewer)))) {
        ;(projectedSlots[slot.key] ??= []).push({
          id: slot.id,
          component: slot.component,
          order: slot.order ?? 99,
        })
      }

      // only the layouts the surviving pages actually need
      const used = new Set(shown.map((page) => page.layout))
      return {
        layouts: layouts
          .filter((layout) => used.has(layout.contract))
          .sort((a, b) => a.contract.localeCompare(b.contract)),
        pages: shown.map((page) => ({
          id: page.page.id,
          path: page.page.path,
          component: page.component,
          layout: page.layout,
        })),
        collections: projectedCollections,
        slots: projectedSlots,
      } satisfies Manifest
    }),
  }
})

export class UiManifest extends Context.Service<
  UiManifest,
  Effect.Success<ReturnType<typeof make>>
>()('@qualy/plugin-ui-registry/UiManifest') {}

export const layer: Layer.Layer<UiManifest, never, UiCatalog> = Layer.effect(UiManifest, make())
