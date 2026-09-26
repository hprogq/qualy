import { Link, type LinkProps } from 'react-router'
import type { NamespacedId } from '@qualy/ui-contract'
import type { ReactNode } from 'react'
import { usePageHref } from './runtime-context.tsx'
import type { PageHrefOptions } from './pages.ts'

// An internal link that names a page instead of repeating its path. The id
// is the whole reference: real component values and paths exist only at the
// declaration, and the manifest is where a path comes from. A page the
// current viewer cannot see renders as plain text rather than a link into a
// route that would only bounce them back - or as whatever `unavailable`
// says instead, `null` for nothing at all; a missing `:name` value fails
// loudly in the href builder.
export function PageLink({
  page,
  params,
  search,
  hash,
  children,
  unavailable,
  ...props
}: {
  page: NamespacedId
  children: ReactNode
  unavailable?: ReactNode
} & PageHrefOptions &
  Omit<LinkProps, 'to' | 'children'>) {
  const href = usePageHref(page, { params, search, hash })
  // `null` is an answer - draw nothing - not the absence of one
  if (!href) return <>{unavailable === undefined ? children : unavailable}</>
  return (
    <Link to={href} {...props}>
      {children}
    </Link>
  )
}
