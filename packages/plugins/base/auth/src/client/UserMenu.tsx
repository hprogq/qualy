import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import {
  PageLink,
  useApi,
  useApiQuery,
  useRunApi,
  useSessionTransition,
  useTheme,
  type ThemeChoice,
} from '@qualy/web-runtime'
import { isAuthenticationError, localeNames, useI18n, useLocale } from '@qualy/web-i18n'
import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
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

export default function UserMenu() {
  const api = useApi(authApi)
  const run = useRunApi()
  const orpc = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const endSession = useSessionTransition()
  const [locale, setLocale] = useLocale()
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
          {/* where they stand, level by level: the tenant names each level, so
              a student reads "College / Class" and a system account reads the
              single level it sits at */}
          <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
            {user.primaryOrgNode.lineage.map((step) => (
              <span key={step.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="shrink-0 text-muted-foreground">{step.typeName}</span>
                <span className="truncate">{step.name}</span>
              </span>
            ))}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* appearance and language are personal preferences, so they live
              with the account rather than in the page chrome. Both are held
              by the browser: nothing about them reaches the server. */}
          <PreferenceRow label={format(m.appearance)}>
            <ThemeChoicePicker />
          </PreferenceRow>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="flex-1">{format(m.language)}</span>
              <span className="text-muted-foreground">{localeNames[locale]}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={(next) => setLocale(next as SupportedLocale)}
              >
                {supportedLocales.map((candidate) => (
                  <DropdownMenuRadioItem key={candidate} value={candidate}>
                    {localeNames[candidate]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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

/** a labelled row of choices inside the menu; not a menu item, so picking
    one adjusts the preference instead of dismissing the menu */
function PreferenceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function ThemeChoicePicker() {
  const { choice, setChoice } = useTheme()
  const { format } = useI18n()
  const options: { value: ThemeChoice; label: string; icon: typeof SunIcon }[] = [
    { value: 'light', label: format(m.themeLight), icon: SunIcon },
    { value: 'dark', label: format(m.themeDark), icon: MoonIcon },
    { value: 'system', label: format(m.themeSystem), icon: MonitorIcon },
  ]
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={choice}
      aria-label={format(m.appearance)}
      onValueChange={(next) => next !== '' && setChoice(next as ThemeChoice)}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
          <option.icon />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
