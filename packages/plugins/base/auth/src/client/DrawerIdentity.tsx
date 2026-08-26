import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon } from 'lucide-react'
import { PageLink, useApiQuery } from '@qualy/web-runtime'
import { isAuthenticationError, useI18n } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { authMessages as m } from './i18n.ts'
import { authApi } from './api.ts'
import { useIdentity } from './identity.ts'
import { initialsOf } from './initials.ts'

// Who is signed in, at the head of the narrow shell's navigation drawer -
// the same account the top bar's corner shows a desktop: the name, the
// number under it, the type at the end. One more line says where they stand
// in the organization: the node's own name, because the ancestry above it
// is context almost nobody needs. It waits behind a tap and arrives as one
// written line, root to leaf, not as a tree that shoves the navigation
// below it off the screen.

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingInline: 4,
    paddingTop: 4,
    paddingBottom: 2,
  },
  boneFrame: {
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: tokens.radiusLg,
  },
  boneLines: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 6,
  },
  boneName: { height: 14, width: 176 },
  boneWhere: { height: 12, width: 128 },
  statusNote: {
    display: 'block',
    paddingInline: 4,
    paddingBlock: 4,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  frame: {
    width: 32,
    height: 32,
    flexShrink: 0,
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
  lines: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 2,
  },
  headLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flexShrink: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: 1.375,
    fontWeight: 600,
  },
  number: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  numberAbsent: {
    fontStyle: 'italic',
    fontVariantNumeric: 'normal',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  typeChip: {
    flexShrink: 0,
  },
  whereButton: {
    display: 'flex',
    minWidth: 0,
    cursor: 'pointer',
    alignItems: 'flex-start',
    gap: 6,
    textAlign: 'left',
    fontSize: '0.75rem',
    lineHeight: 1.625,
    transitionProperty: 'color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  whereText: {
    minWidth: 0,
    textWrap: 'pretty',
  },
  whereTextClosed: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  whereGlyph: {
    marginTop: 4,
    width: 12,
    height: 12,
    flexShrink: 0,
    transitionProperty: 'transform',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  whereGlyphOpen: {
    transform: 'rotate(180deg)',
  },
})

export default function DrawerIdentity() {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const [lineageOpen, setLineageOpen] = useState(false)
  const me = useIdentity()

  if (me.isPending) {
    // the shape of the answer, so the drawer opens at its final height
    // instead of growing one when the identity lands
    return (
      <div {...stylex.props(styles.row)}>
        <Skeleton className={stylex.props(styles.boneFrame).className} />
        <div {...stylex.props(styles.boneLines)}>
          <Skeleton className={stylex.props(styles.boneName).className} />
          <Skeleton className={stylex.props(styles.boneWhere).className} />
        </div>
      </div>
    )
  }
  if (me.isError) {
    if (isAuthenticationError(me.error)) {
      return (
        <div {...stylex.props(styles.row)}>
          <Button variant="outline" size="sm" asChild>
            <PageLink page="auth/login">{format(m.signIn)}</PageLink>
          </Button>
        </div>
      )
    }
    return (
      <span {...stylex.props(styles.statusNote)} role="status">
        {formatError(me.error)}
      </span>
    )
  }

  const user = me.data.user
  const lineage = user.primaryOrgNode.lineage
  const path = lineage.map((step) => step.name).join(' / ')

  return (
    <div {...stylex.props(styles.row)}>
      <Avatar className={stylex.props(styles.frame).className}>
        <AvatarFallback className={stylex.props(styles.monogram).className}>
          {initialsOf(user.displayName)}
        </AvatarFallback>
      </Avatar>
      <div {...stylex.props(styles.lines)}>
        {/* two lines, not three: who they are on the first, where they
            stand on the second - the number rides beside the name, the way
            the top bar's menu says it */}
        <span {...stylex.props(styles.headLine)}>
          <span {...stylex.props(styles.name)}>{user.displayName}</span>
          {user.businessNo !== null ? (
            <span {...stylex.props(styles.number)}>{user.businessNo}</span>
          ) : (
            <span {...stylex.props(styles.number, styles.numberAbsent)}>
              {format(m.noBusinessNo)}
            </span>
          )}
          <span {...stylex.props(styles.spacer)} />
          <Badge variant="secondary" className={stylex.props(styles.typeChip).className}>
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
          {...stylex.props(styles.whereButton)}
        >
          <span
            {...stylex.props(
              styles.whereText,
              !(lineageOpen && lineage.length > 1) && styles.whereTextClosed,
            )}
          >
            {lineageOpen && lineage.length > 1 ? path : user.primaryOrgNode.name}
          </span>
          {lineage.length > 1 && (
            <ChevronDownIcon
              aria-hidden
              {...stylex.props(styles.whereGlyph, lineageOpen && styles.whereGlyphOpen)}
            />
          )}
        </button>
      </div>
    </div>
  )
}
