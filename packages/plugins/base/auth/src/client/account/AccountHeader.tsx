import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery } from '@qualy/web-runtime'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { UserRoundIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Skeleton } from '@qualy/ui/skeleton'
import { initialsOf } from '@qualy/ui/person'
import { Tag } from '@qualy/ui/screen'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { authApi } from '../api.ts'

import { PersonFacts, type PersonFact } from '../iam/person-facts.tsx'
import * as m from '#messages'

// Who is signed in, above every page of their own account: the name, the
// kind of person they are filed as, their number and the unit they stand
// at. Read from the session rather than from the address - there is nobody
// else it could be about.

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
  // held at the height of a name and a unit, so the outline, the header and
  // a header with no unit all stand the same
  text: {
    display: 'flex',
    minWidth: 0,
    minHeight: 56,
    flexGrow: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 6,
  },
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
  // what the banner says when the reader's own record would not come: in
  // the banner's own place and measure, not an alert standing in for it
  unread: {
    margin: 0,
    minWidth: 0,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  unreadGlyph: { width: 22, height: 22, color: tokens.mutedForeground },
  boneName: { width: 160, height: 24, borderRadius: 6 },
  boneMeta: { width: '100%', maxWidth: 240, height: 14, borderRadius: 4 },
})

export default function AccountHeader() {
  const query = useApiQuery(authApi)

  const businessNoWord = useTerm(authTerms.businessNumber)
  const self = useQuery(query.self.getSelf.queryOptions())

  const me = self.data
  // One line and no retry of its own: the page under it reads the same
  // record, or has its own to read, and says the failure with the one retry
  // a reader should see. Two for one reading was one too many.
  if (me === undefined && self.isError) {
    return (
      <div data-testid="account-header" data-state="unread" {...stylex.props(styles.who)}>
        <Avatar className={stylex.props(styles.portrait).className}>
          <AvatarFallback className={stylex.props(styles.portraitFace).className}>
            <UserRoundIcon aria-hidden {...stylex.props(styles.unreadGlyph)} />
          </AvatarFallback>
        </Avatar>
        <div {...stylex.props(styles.text)}>
          <p {...stylex.props(styles.unread)}>{m.account_headerUnread()}</p>
        </div>
      </div>
    )
  }
  // The line the directory shows over their record, as far as it is theirs:
  // their number and their unit. A number they do not have is left out
  // rather than said missing, since it is not theirs to fill in; their
  // address is the security page's, where it can be proven.
  const facts: PersonFact[] =
    me === undefined
      ? []
      : [
          ...(me.businessNo === null
            ? []
            : [{ key: 'business-no', label: businessNoWord, value: me.businessNo }]),
          ...(me.unit === null
            ? []
            : [
                {
                  key: 'unit',
                  label: m.person_placement(),
                  value: me.unit.name,
                  title: me.unitLineage.map((step) => step.name).join(' / '),
                },
              ]),
        ]
  return (
    <div data-testid="account-header" {...stylex.props(styles.who)}>
      {me === undefined ? (
        <>
          <Skeleton circle className={stylex.props(styles.portrait).className} />
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
            {facts.length > 0 && <PersonFacts facts={facts} />}
          </div>
        </>
      )}
    </div>
  )
}
