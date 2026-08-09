import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { PageLink, useApi, useApiQuery, useRunApi, useSessionTransition } from '@qualy/web-runtime'
import { isAuthenticationError, useI18n } from '@qualy/web-i18n'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { authMessages as m } from './i18n.ts'
import { authApi } from './api.ts'

// The sidebar-user contribution: the signed-in person as a card - avatar,
// name over their number, their user type on the right - opening a menu
// beside it with the whole identity, where they stand in the organization,
// and the way out. Anonymous visitors get a sign-in link, and a session
// state that simply cannot be determined says so instead of guessing.

/** latin names shrink to initials, cjk names keep their first characters */
const initialsOf = (name: string): string => {
  const trimmed = name.trim()
  if (trimmed === '') return '?'
  const words = trimmed.split(/\s+/)
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => [...word][0]!.toUpperCase())
      .join('')
  }
  const characters = [...trimmed]
  return /^[\x20-\x7e]+$/.test(trimmed)
    ? characters[0]!.toUpperCase()
    : characters.slice(0, 2).join('')
}

/** the standing, without the root the brand already names */
const standingOf = (lineage: readonly { name: string }[]): string =>
  (lineage.length > 1 ? lineage.slice(1) : lineage).map((step) => step.name).join(' / ')

export default function UserMenu() {
  const api = useApi(authApi)
  const run = useRunApi()
  const orpc = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const endSession = useSessionTransition()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const me = useQuery({ ...orpc.auth.getSession.queryOptions(), retry: false })

  if (me.isPending) return null
  if (me.isError) {
    // only an authentication failure means "not signed in"; a network or
    // server fault must not be dressed up as a sign-in prompt
    if (isAuthenticationError(me.error)) {
      return (
        <Button variant="outline" size="sm" className="w-full" asChild>
          <PageLink page="auth/login">{format(m.signIn)}</PageLink>
        </Button>
      )
    }
    return (
      <span className="block px-2 text-xs text-muted-foreground" role="status">
        {formatError(me.error)}
      </span>
    )
  }

  const user = me.data.user

  const identity = (
    <>
      <Avatar className="rounded-lg">
        <AvatarFallback className="rounded-lg bg-primary text-xs font-medium text-primary-foreground">
          {initialsOf(user.displayName)}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{user.displayName}</span>
        {user.businessNo !== null ? (
          <span className="block truncate text-xs text-muted-foreground">{user.businessNo}</span>
        ) : (
          <span className="block truncate text-xs text-muted-foreground/70 italic">
            {format(m.noBusinessNo)}
          </span>
        )}
      </span>
      <Badge variant="secondary" className="shrink-0 self-center">
        {user.userType.name}
      </Badge>
    </>
  )

  return (
    <div className="flex flex-col gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
          >
            {identity}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-64">
          <DropdownMenuLabel className="flex items-center gap-2.5 font-normal">
            {identity}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* where they stand: the unit's kind, then the path down to it */}
          <DropdownMenuLabel className="flex items-center gap-2 font-normal">
            <Badge variant="outline" className="shrink-0">
              {user.primaryOrgNode.orgType.name}
            </Badge>
            <span className="truncate text-xs text-muted-foreground">
              {standingOf(user.primaryOrgNode.lineage)}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              setSignOutError(null)
              // only the server can end the session: the cookie is HttpOnly,
              // so a failed request leaves the identity intact and must say
              // so instead of pretending to have signed the user out
              void run(api.auth.endSession())
                .then(() => endSession({ destination: { kind: 'page', page: 'auth/login' } }))
                .catch((error: unknown) => setSignOutError(formatError(error)))
            }}
          >
            {format(m.signOut)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {signOutError && (
        <span className="block px-2 text-xs text-destructive" role="alert">
          {signOutError}
        </span>
      )}
    </div>
  )
}
