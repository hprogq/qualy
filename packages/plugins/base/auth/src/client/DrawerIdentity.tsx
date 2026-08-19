import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon } from 'lucide-react'
import { PageLink, useApiQuery } from '@qualy/web-runtime'
import { isAuthenticationError, useI18n } from '@qualy/web-i18n'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Skeleton } from '@qualy/ui/skeleton'
import { authMessages as m } from './i18n.ts'
import { authApi } from './api.ts'
import { initialsOf } from './initials.ts'

// Who is signed in, at the head of the narrow shell's navigation drawer -
// the same account the top bar's corner shows a desktop: the name, the
// number under it, the type at the end. One more line says where they stand
// in the organization: the node's own name, because the ancestry above it
// is context almost nobody needs. It waits behind a tap and arrives as one
// written line, root to leaf, not as a tree that shoves the navigation
// below it off the screen.

export default function DrawerIdentity() {
  const orpc = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const [lineageOpen, setLineageOpen] = useState(false)
  const me = useQuery({
    ...orpc.auth.getSession.queryOptions(),
    retry: false,
    // The drawer mounts fresh on every open; the person did not change on
    // the way. Within this window the cached identity stands as-is, so
    // opening the drawer costs no request and the head never pops in late.
    staleTime: 30_000,
  })

  if (me.isPending) {
    // the shape of the answer, so the drawer opens at its final height
    // instead of growing one when the identity lands
    return (
      <div className="flex items-center gap-2.5 px-1 pt-1 pb-0.5">
        <Skeleton className="size-8 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-44" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    )
  }
  if (me.isError) {
    if (isAuthenticationError(me.error)) {
      return (
        <div className="flex items-center px-1 pt-1 pb-0.5">
          <Button variant="outline" size="sm" asChild>
            <PageLink page="auth/login">{format(m.signIn)}</PageLink>
          </Button>
        </div>
      )
    }
    return (
      <span className="block px-1 py-1 text-xs text-muted-foreground" role="status">
        {formatError(me.error)}
      </span>
    )
  }

  const user = me.data.user
  const lineage = user.primaryOrgNode.lineage
  const path = lineage.map((step) => step.name).join(' / ')

  return (
    <div className="flex items-center gap-2.5 px-1 pt-1 pb-0.5">
      <Avatar className="size-8 shrink-0 rounded-lg">
        <AvatarFallback className="rounded-lg bg-primary text-xs font-medium text-primary-foreground">
          {initialsOf(user.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* two lines, not three: who they are on the first, where they
            stand on the second - the number rides beside the name, the way
            the top bar's menu says it */}
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 truncate text-sm leading-snug font-semibold">
            {user.displayName}
          </span>
          {user.businessNo !== null ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
              {user.businessNo}
            </span>
          ) : (
            <span className="min-w-0 truncate text-xs text-muted-foreground/70 italic">
              {format(m.noBusinessNo)}
            </span>
          )}
          <span className="flex-1" />
          <Badge variant="secondary" className="shrink-0">
            {user.userType.name}
          </Badge>
        </span>
        {/* the node they stand at; the tap flips the same line to the whole
            written path and back. Both states share one text box - same
            size, same leading - so nothing above or below moves, the line
            only wraps further */}
        <button
          type="button"
          aria-expanded={lineageOpen}
          onClick={() => setLineageOpen((now) => !now)}
          className="flex min-w-0 cursor-pointer items-start gap-1.5 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:text-foreground"
        >
          <span
            className={cn(
              'min-w-0 text-pretty',
              !(lineageOpen && lineage.length > 1) && 'truncate',
            )}
          >
            {lineageOpen && lineage.length > 1 ? path : user.primaryOrgNode.name}
          </span>
          {lineage.length > 1 && (
            <ChevronDownIcon
              aria-hidden
              className={cn(
                'mt-1 size-3 shrink-0 transition-transform',
                lineageOpen && 'rotate-180',
              )}
            />
          )}
        </button>
      </div>
    </div>
  )
}
