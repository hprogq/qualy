import { Context, Effect, Layer } from 'effect'
import {
  componentKey,
  isVisibleTo,
  navigationCollections,
  primaryNavigation,
  type NamespacedId,
  type NavigationItem,
  type ResolvedNavigationItem,
  type UiVisibility,
  type ViewerAccess,
} from '@qualy/ui-contract'
import type { Principal } from '@qualy/rbac-contract'
import { UiAuthorizer } from './authorizer.ts'
import { Ui } from './registry.ts'

// The manifest is an authorized projection.
//
// One authorizer lookup per request decides which surfaces the viewer may
// DISCOVER. Hiding a page is never authorization, since every api call is
// authorized on its own, but a viewer must not learn that a capability, its
// route or its component even exists. Internal declarations, visibility and
// permission codes among them, never leave.

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
  readonly slots: Readonly<
    Record<string, readonly { id: string; component: string; order: number }[]>
  >
}

const sorted = <T extends { order?: number; id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id))

export const make = Effect.fn('Ui.manifest.make')(function* () {
  // the registry handle, not its contents: a plugin registers while its own
  // layer is built, and this one is built before some of them
  const registry = yield* Ui

  const collect = Effect.fn('Ui.manifest.collect')(function* () {
    const surfaces = yield* registry.surfaces
    const pages = surfaces.pages
    const layouts = surfaces.layouts
    const slots = surfaces.slots
    // a page's navigation entry is sugar for a collection item that inherits
    // the page's visibility, so the two cannot drift into disagreeing about
    // who may see them
    const collections = [
      ...surfaces.collections,
      ...pages.flatMap(({ declaration: page }) => {
        const navigation = page.navigation
        if (!navigation) return []
        const id = `${page.page.id}/nav` as NamespacedId
        return [
          {
            key: primaryNavigation.key,
            id,
            // Absent keys are omitted rather than set to undefined. A key whose
            // value is undefined is still a key, and it is not a JSON value, so
            // encoding the response fails on it. zod and JSON.stringify both
            // swallowed that, which is why the oRPC path never noticed.
            value: {
              id,
              label: navigation.label,
              target: { kind: 'page' as const, pageId: page.page.id },
              ...(navigation.icon === undefined ? {} : { icon: navigation.icon }),
              ...(navigation.order === undefined ? {} : { order: navigation.order }),
              ...(navigation.group === undefined ? {} : { group: navigation.group }),
            } satisfies NavigationItem,
            visibility: page.visibility,
            order: navigation.order,
          },
        ]
      }),
    ]
    return { pages, layouts, slots, collections }
  })

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
      const { pages, layouts, slots, collections } = yield* collect()
      const byContract = new Map(layouts.map((layout) => [layout.declaration.contract, layout]))

      const shown = pages.filter(({ declaration: page }) => {
        if (!visible(page.visibility, viewer)) return false
        if (byContract.has(page.layout)) return true
        return false
      })
      const dropped = pages.filter(
        ({ declaration: page }) => visible(page.visibility, viewer) && !byContract.has(page.layout),
      )
      for (const { declaration: page } of dropped) {
        yield* Effect.logWarning(
          `page ${page.page.id} dropped: no provider for layout ${page.layout}`,
        )
      }
      const shownById = new Map(shown.map((page) => [page.declaration.page.id, page]))

      const projectedCollections: Record<string, unknown[]> = {}
      for (const item of sorted(collections.filter((item) => visible(item.visibility, viewer)))) {
        let value = item.value
        if (navigationCollections.includes(item.key as NamespacedId)) {
          const navigation = value as NavigationItem
          if (navigation.target.kind === 'page') {
            // a page target resolves to the path the router mounts, and drops
            // out entirely when the viewer cannot see that page
            const page = shownById.get(navigation.target.pageId)
            if (!page) continue
            value = {
              ...navigation,
              target: {
                kind: 'page',
                pageId: page.declaration.page.id,
                path: page.declaration.page.path,
              },
            } satisfies ResolvedNavigationItem
          }
        }
        ;(projectedCollections[item.key] ??= []).push(value)
      }

      // The component that crosses the wire is the derived registry key,
      // computed from the declaring plugin and the module reference - the
      // same derivation the build used to key the browser registry, so the
      // two cannot disagree. The reference itself never leaves the server.
      const projectedSlots: Record<string, { id: string; component: string; order: number }[]> = {}
      const visibleSlots = slots.filter((slot) => visible(slot.declaration.visibility, viewer))
      for (const slot of [...visibleSlots].sort(
        (a, b) =>
          (a.declaration.order ?? 99) - (b.declaration.order ?? 99) ||
          a.declaration.id.localeCompare(b.declaration.id),
      )) {
        ;(projectedSlots[slot.declaration.key] ??= []).push({
          id: slot.declaration.id,
          component: componentKey(slot.owner, slot.declaration.component),
          order: slot.declaration.order ?? 99,
        })
      }

      // only the layouts the surviving pages actually need
      const used = new Set(shown.map((page) => page.declaration.layout))
      return {
        layouts: layouts
          .filter((layout) => used.has(layout.declaration.contract))
          .sort((a, b) => a.declaration.contract.localeCompare(b.declaration.contract))
          .map((layout) => ({
            contract: layout.declaration.contract,
            provider: layout.declaration.provider,
            component: componentKey(layout.owner, layout.declaration.component),
          })),
        pages: shown.map((page) => ({
          id: page.declaration.page.id,
          path: page.declaration.page.path,
          component: componentKey(page.owner, page.declaration.component),
          layout: page.declaration.layout,
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

export const layer: Layer.Layer<UiManifest, never, Ui> = Layer.effect(UiManifest, make())
