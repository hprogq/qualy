import { Link, type LinkProps } from 'react-router'
import type { PageRef, ParamsOption } from '@qualy/ui-contract'
import type { ReactNode } from 'react'
import { usePageHref } from './index.tsx'
import type { PageHrefOptions } from './pages.ts'

// an internal link that names a page instead of repeating its path. A page
// the current viewer cannot see renders as plain text rather than a link
// into a route that would only bounce them back. Pages with `:name` segments
// demand their values here, so a detail link cannot be built half-formed.
export function PageLink<const Ref extends PageRef>({
  page,
  params,
  search,
  hash,
  children,
  unavailable,
  ...props
}: {
  page: Ref
  children: ReactNode
  unavailable?: ReactNode
} & ParamsOption<Ref> &
  Omit<PageHrefOptions, 'params'> &
  Omit<LinkProps, 'to' | 'children'>) {
  const href = usePageHref(page, { params, search, hash })
  if (!href) return <>{unavailable ?? children}</>
  return (
    <Link to={href} {...props}>
      {children}
    </Link>
  )
}
