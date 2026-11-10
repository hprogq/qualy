import { surfaceLabel } from '@qualy/ui-contract'

/** Resolve only a router match present in this request's authorized manifest. */
export const matchedPage = <T extends { readonly id: string }>(
  pages: readonly T[],
  routeId: string | undefined,
): T | undefined =>
  routeId === undefined
    ? undefined
    : pages.find(({ id }) => surfaceLabel({ kind: 'page', id }) === routeId)
