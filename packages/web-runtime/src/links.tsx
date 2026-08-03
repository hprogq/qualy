import { Link, type LinkProps } from 'react-router'
import type { PageRef } from '@qualy/ui-contract'
import type { ReactNode } from 'react'
import { usePageHref } from './index.tsx'
import type { PageHrefOptions } from './pages.ts'

// an internal link that names a page instead of repeating its path. A page
// the current viewer cannot see renders as plain text rather than a link
// into a route that would only bounce them back.
export function PageLink({
  page,
  search,
  hash,
  children,
  unavailable,
  ...props
}: {
  page: PageRef
  children: ReactNode
  unavailable?: ReactNode
} & PageHrefOptions &
  Omit<LinkProps, 'to' | 'children'>) {
  const href = usePageHref(page, { search, hash })
  if (!href) return <>{unavailable ?? children}</>
  return (
    <Link to={href} {...props}>
      {children}
    </Link>
  )
}
