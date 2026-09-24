import type { UiText } from '@qualy/i18n-contract'
import { Context, Effect, Layer } from 'effect'
import {
  isVisibleTo,
  navigationCollections,
  navigationGroups,
  primaryNavigation,
  type NamespacedId,
  type NavigationGroup,
  type NavigationItem,
  type ResolvedNavigationItem,
  type UiVisibility,
  type ViewerAccess,
} from '@qualy/ui-contract'
import type { Principal } from '@qualy/rbac-contract'
import { UiAuthorizer } from './authorizer.ts'
import { Ui } from './registry.ts'

// The manifest is an authorized projection, and everything in it is a
// product fact.
//
// One authorizer lookup per request decides which surfaces the viewer may
// DISCOVER. Hiding a page is never authorization, since every api call is
// authorized on its own, but a viewer must not learn that a capability, its
// route or its implementation even exists. Internal declarations, visibility
// and permission codes among them, never leave.
//
// Nor does the implementation. A surface is named by what it IS - the page
// id, the layout contract, the slot and the item filed under it - and the
// browser resolves its renderer from that name. It used to be named by the
// package and source file behind it, which is how `@qualy/plugin-assessment`
// and `./client/ReviewPage.tsx` became public protocol.

export interface ManifestLayout {
  readonly contract: string
}

export interface ManifestPage {
  readonly id: string
  readonly path: string
  readonly layout: string
  /** what a tab should call it, in the viewer's own language once resolved */
  readonly title?: UiText
}

export interface Manifest {
  /** whether a live session was recognised, and nothing about what it may see */
  readonly viewer: 'anonymous' | 'authenticated'
  readonly layouts: readonly ManifestLayout[]
  readonly pages: readonly ManifestPage[]
  readonly collections: Readonly<Record<string, readonly unknown[]>>
  readonly slots: Readonly<Record<string, readonly { id: string; order: number }[]>>
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
            collection: primaryNavigation,
            id,
            // Absent keys are omitted rather than set to undefined. A key whose
            // value is undefined is still a key, and it is not a JSON value, so
            // encoding the response fails on it. The old contract layer and
            // JSON.stringify both swallowed that, which is why it went unnoticed.
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
        if (navigationCollections.includes(item.collection.key)) {
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
        ;(projectedCollections[item.collection.key] ??= []).push(value)
      }

      // A section nothing files under is not a section.
      //
      // Groups survive their own visibility check, which asks whether the
      // reader may see the section - not whether anything is in it. So a
      // student with no page under "Organization & access" was still told the
      // section exists, and the shell had a heading with nothing beneath it.
      // Its name is a small disclosure too: the reader learns what parts of
      // the product they are being kept out of.
      const filed = new Set<NamespacedId>(
        navigationCollections.flatMap((key) =>
          (projectedCollections[key] ?? []).flatMap((entry) => {
            const group = (entry as NavigationItem).group
            return group === undefined ? [] : [group]
          }),
        ),
      )
      const groups = projectedCollections[navigationGroups.key]
      if (groups) {
        // a group may be filed under another one, and a parent whose only
        // child is empty is empty as well - resolved by walking up the chain
        const byId = new Map(groups.map((group) => [(group as NavigationGroup).id, group]))
        for (const id of [...filed]) {
          let step = byId.get(id) as NavigationGroup | undefined
          while (step?.parent !== undefined) {
            filed.add(step.parent)
            step = byId.get(step.parent) as NavigationGroup | undefined
          }
        }
        projectedCollections[navigationGroups.key] = groups.filter((group) =>
          filed.has((group as NavigationGroup).id),
        )
      }

      // An item is its slot and its id. That pair is what the browser
      // resolves the renderer by, and the module reference stays here.
      const projectedSlots: Record<string, { id: string; order: number }[]> = {}
      const visibleSlots = slots.filter((slot) => visible(slot.declaration.visibility, viewer))
      for (const slot of [...visibleSlots].sort(
        (a, b) =>
          (a.declaration.order ?? 99) - (b.declaration.order ?? 99) ||
          a.declaration.id.localeCompare(b.declaration.id),
      )) {
        ;(projectedSlots[slot.declaration.key] ??= []).push({
          id: slot.declaration.id,
          order: slot.declaration.order ?? 99,
        })
      }

      // only the layouts the surviving pages actually need
      const used = new Set(shown.map((page) => page.declaration.layout))
      return {
        viewer: viewer.authenticated ? ('authenticated' as const) : ('anonymous' as const),
        layouts: layouts
          .filter((layout) => used.has(layout.declaration.contract))
          .sort((a, b) => a.declaration.contract.localeCompare(b.declaration.contract))
          .map((layout) => ({ contract: layout.declaration.contract })),
        pages: shown.map((page) => {
          // the menu entry's words when there is one, so a page and its tab
          // cannot come to disagree about what the page is called
          const title = page.declaration.title ?? page.declaration.navigation?.label
          return {
            id: page.declaration.page.id,
            path: page.declaration.page.path,
            layout: page.declaration.layout,
            ...(title === undefined ? {} : { title }),
          }
        }),
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
