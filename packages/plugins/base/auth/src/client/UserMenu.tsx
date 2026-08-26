import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { PageLink, useApi, useApiQuery, useRunApi, useSessionTransition } from '@qualy/web-runtime'
import { isAuthenticationError, useI18n } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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
import { LocaleChoicePicker, ThemeChoicePicker } from './identity-bits.tsx'
import { initialsOf } from './initials.ts'

// The account at the end of the top bar: an avatar and a name, opening a menu
// with the whole identity - their number, their type, where they stand in the
// organization - and the way out. The bar has one line to spare, so the card
// that used to sit in a sidebar footer moved inside the menu it opens.
//
// Anonymous visitors get a sign-in link, and a session state that simply
// cannot be determined says so instead of guessing.

const styles = stylex.create({
  seat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  statusNote: {
    display: 'block',
    paddingInline: 8,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  errorNote: {
    display: 'block',
    paddingInline: 8,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.danger,
  },
  trigger: {
    display: 'flex',
    maxWidth: '14rem',
    alignItems: 'center',
    gap: 8,
    borderRadius: tokens.radiusMd,
    padding: 4,
    paddingRight: 8,
    textAlign: 'left',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    outline: 'none',
    backgroundColor: {
      default: null,
      ':hover': tokens.surfaceMuted,
    },
    boxShadow: {
      default: 'none',
      ':focus-visible': `0 0 0 2px ${tokens.focusRing}`,
    },
  },
  // while its menu is up, the trigger keeps the pressed face; the menu
  // reports openness through onOpenChange, so this is plain state
  triggerOpen: {
    backgroundColor: tokens.surfaceMuted,
  },
  smallFrame: {
    width: 28,
    height: 28,
    flexShrink: 0,
  },
  smallFace: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
  },
  triggerName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
    display: {
      default: 'none',
      '@media (min-width: 640px)': 'block',
    },
  },
  menu: {
    width: '16rem',
  },
  identityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontWeight: 400,
  },
  frame: {
    borderRadius: tokens.radiusLg,
  },
  monogram: {
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
  },
  who: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  whoName: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  whoNo: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  whoNoAbsent: {
    fontStyle: 'italic',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  typeChip: {
    flexShrink: 0,
    alignSelf: 'center',
  },
  lineage: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontWeight: 400,
  },
  lineageStep: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    fontSize: '0.75rem',
    lineHeight: '1rem',
  },
  kindChip: {
    flexShrink: 0,
    fontWeight: 400,
  },
  stepName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  preferenceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingInline: 8,
    paddingBlock: 6,
  },
  preferenceLabel: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
})

export default function UserMenu() {
  const api = useApi(authApi)
  const run = useRunApi()
  const orpc = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const endSession = useSessionTransition()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // one identity, told once: surfaces that remount (the drawer, this menu
  // after a layout change) read the cached answer instead of asking again
  const me = useQuery({ ...orpc.auth.getSession.queryOptions(), retry: false, staleTime: 30_000 })

  if (me.isPending) return null
  if (me.isError) {
    // only an authentication failure means "not signed in"; a network or
    // server fault must not be dressed up as a sign-in prompt
    if (isAuthenticationError(me.error)) {
      return (
        <Button variant="outline" size="sm" asChild>
          <PageLink page="auth/login">{format(m.signIn)}</PageLink>
        </Button>
      )
    }
    return (
      <span {...stylex.props(styles.statusNote)} role="status">
        {formatError(me.error)}
      </span>
    )
  }

  const user = me.data.user

  const identity = (
    <>
      <Avatar className={stylex.props(styles.frame).className}>
        <AvatarFallback className={stylex.props(styles.monogram).className}>
          {initialsOf(user.displayName)}
        </AvatarFallback>
      </Avatar>
      <span {...stylex.props(styles.who)}>
        <span {...stylex.props(styles.whoName)}>{user.displayName}</span>
        {user.businessNo !== null ? (
          <span {...stylex.props(styles.whoNo)}>{user.businessNo}</span>
        ) : (
          <span {...stylex.props(styles.whoNo, styles.whoNoAbsent)}>{format(m.noBusinessNo)}</span>
        )}
      </span>
      <Badge variant="secondary" className={stylex.props(styles.typeChip).className}>
        {user.userType.name}
      </Badge>
    </>
  )

  return (
    <div {...stylex.props(styles.seat)}>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          {/* the bar shows who, the menu shows everything else */}
          <button type="button" {...stylex.props(styles.trigger, menuOpen && styles.triggerOpen)}>
            <Avatar className={stylex.props(styles.smallFrame).className}>
              <AvatarFallback className={stylex.props(styles.smallFace).className}>
                {initialsOf(user.displayName)}
              </AvatarFallback>
            </Avatar>
            <span {...stylex.props(styles.triggerName)}>{user.displayName}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          className={stylex.props(styles.menu).className}
        >
          <DropdownMenuLabel className={stylex.props(styles.identityRow).className}>
            {identity}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* where they stand, level by level: the tenant names each level, so
              a student reads "College / Class" and a system account reads the
              single level it sits at */}
          <DropdownMenuLabel className={stylex.props(styles.lineage).className}>
            {user.primaryOrgNode.lineage.map((step) => (
              <span key={step.id} {...stylex.props(styles.lineageStep)}>
                {/* the level's kind is a tag, not a sentence fragment */}
                <Badge variant="outline" className={stylex.props(styles.kindChip).className}>
                  {step.typeName}
                </Badge>
                <span {...stylex.props(styles.stepName)}>{step.name}</span>
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
          {/* the same row shape as the appearance above: chosen in place,
              nothing opens over the menu */}
          <PreferenceRow label={format(m.language)}>
            <LocaleChoicePicker />
          </PreferenceRow>
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
        <span {...stylex.props(styles.errorNote)} role="alert">
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
    <div {...stylex.props(styles.preferenceRow)}>
      <span {...stylex.props(styles.preferenceLabel)}>{label}</span>
      {children}
    </div>
  )
}
