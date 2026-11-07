import {
  resourceGrantPresenters,
  resourceGrantRenderer,
  type ResourceGrantPresenter,
  type SlotSurface,
} from '@qualy/ui-contract'
import type { Manifest } from '@qualy/web-runtime'
import { grantPresenterOf } from './grant-presenter.ts'

export const grantReferences = (
  manifest: Manifest,
  grants: readonly { readonly resource: Parameters<typeof grantPresenterOf>[1] }[],
): SlotSurface[] => {
  const presenters = (manifest.collections[resourceGrantPresenters.key] ??
    []) as ResourceGrantPresenter[]
  const renderers = new Set(
    grants.map(({ resource }) => grantPresenterOf(presenters, resource)?.renderer),
  )
  return [...renderers].flatMap((id) =>
    id === undefined ? [] : [{ kind: 'slot', slot: resourceGrantRenderer.key, id }],
  )
}
