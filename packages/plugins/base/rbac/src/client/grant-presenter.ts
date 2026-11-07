import type { ResourceGrantPresenter } from '@qualy/ui-contract'

export const GRANT_FRESH_MS = 15_000

export const grantPresenterOf = (
  presenters: readonly ResourceGrantPresenter[],
  resource: { readonly namespace: string; readonly type: string } | null,
) =>
  presenters.find(
    (presenter) => presenter.namespace === resource?.namespace && presenter.type === resource.type,
  )
