import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Feedback } from '@qualy/ui/admin'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Skeleton } from '@qualy/ui/skeleton'
import { initialsOf } from '@qualy/ui/person'
import { Tag } from '@qualy/ui/screen'
import { authApi } from '../api.ts'

// Who is signed in, above every page of their own account: the name, the
// kind of person they are filed as, and the unit they stand at. Read from
// the session rather than from the address - there is nobody else it could
// be about.

const styles = stylex.create({
  who: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    columnGap: { default: 16, [breakpoints.phone]: 12 },
  },
  portrait: {
    width: { default: 52, [breakpoints.phone]: 44 },
    height: { default: 52, [breakpoints.phone]: 44 },
    flexShrink: 0,
  },
  portraitFace: {
    backgroundColor: tokens.surfaceMuted,
    color: tokens.surfaceMutedForeground,
    fontSize: 19,
    fontWeight: 600,
  },
  text: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 6 },
  nameRow: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  name: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 22,
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  where: { fontSize: 13, color: tokens.mutedForeground },
  boneName: { width: 160, height: 24, borderRadius: 6 },
  boneMeta: { width: '100%', maxWidth: 240, height: 14, borderRadius: 4 },
})

export default function AccountHeader() {
  const query = useApiQuery(authApi)
  const { formatError } = useI18n()
  const self = useQuery(query.self.getSelf.queryOptions())

  if (self.isError) return <Feedback message={formatError(self.error)} />
  const me = self.data
  return (
    <div data-testid="account-header" {...stylex.props(styles.who)}>
      {me === undefined ? (
        <>
          <Skeleton className={stylex.props(styles.portrait).className} />
          <div {...stylex.props(styles.text)}>
            <Skeleton className={stylex.props(styles.boneName).className} />
            <Skeleton className={stylex.props(styles.boneMeta).className} />
          </div>
        </>
      ) : (
        <>
          <Avatar className={stylex.props(styles.portrait).className}>
            <AvatarFallback className={stylex.props(styles.portraitFace).className}>
              {initialsOf(me.displayName)}
            </AvatarFallback>
          </Avatar>
          <div {...stylex.props(styles.text)}>
            <div {...stylex.props(styles.nameRow)}>
              <h1 {...stylex.props(styles.name)}>{me.displayName}</h1>
              <Tag>{me.userType.name}</Tag>
            </div>
            {me.unit !== null && <span {...stylex.props(styles.where)}>{me.unit.name}</span>}
          </div>
        </>
      )}
    </div>
  )
}
