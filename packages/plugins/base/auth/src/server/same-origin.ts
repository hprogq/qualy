/**
 * A driver's redirect target, kept same-origin.
 *
 * An absolute url is dropped rather than followed: the sign-in screen sends a
 * visitor there, and a driver that names another origin would be redirecting
 * them off the application under the application's own name.
 */
export const sameOriginPath = (href: string): string | undefined => {
  if (!href.startsWith('/')) return undefined
  const sentinel = 'https://qualy.invalid'
  let target: URL
  try {
    target = new URL(href, sentinel)
  } catch {
    return undefined
  }
  if (target.origin !== sentinel) return undefined
  return `${target.pathname}${target.search}${target.hash}`
}
