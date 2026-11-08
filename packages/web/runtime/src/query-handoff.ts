import type { QueryKey } from '@tanstack/react-query'

// What a page's server entry hands the page of a read it had not finished
// when the html went out (docs/adr/0012-rsc-data-mode.md): written by the
// server (@qualy/web-rsc/queries), followed by the page (query-hydration.tsx).

/** what a read that followed the html came to: an answer, or the page's to ask */
export type Arrival =
  | { readonly kind: 'answer'; readonly value: unknown }
  | { readonly kind: 'ask' }

/** a read still on its way when the html went out, under the key the page reads it with */
export interface Coming {
  readonly queryKey: QueryKey
  readonly arrival: Promise<Arrival>
}
