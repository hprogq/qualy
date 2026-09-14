import { sanitizePath } from './sanitize.ts'

// Which screen the viewer is on, kept outside the registry because two
// different callers need it: the sink, which is told when it changes, and the
// provider, which asks for it at a moment of its own choosing.
//
// A vendor sdk typically wants a page address as a plain string and asks for
// it whenever it is about to send something. That call cannot be given
// arguments, so the answer has to be readable from module state.

/** the page a viewer is on, as a name rather than an address */
export interface ObservedPage {
  /** the manifest's stable page id, such as `assessment/review` */
  readonly pageId?: string
  /** the route template, such as `/assessment/batches/:batchId/review` */
  readonly route?: string
}

let current: ObservedPage = {}

export const currentObservedPage = (): ObservedPage => current

export const rememberObservedPage = (page: ObservedPage): void => {
  current = page
}

/**
 * The page as an address a platform will group by.
 *
 * The route template when the manifest matched one, and a masked pathname
 * when it did not - before the manifest has loaded, or on an address no page
 * owns. Never the real address.
 */
export const observedPageUrl = (): string => {
  const route = current.route
  if (route !== undefined && route !== '') return route
  if (typeof location === 'undefined') return '/'
  return sanitizePath(location.pathname)
}
