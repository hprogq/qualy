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
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { authApi } from '../api.ts'
import { iamMessages as m } from '../i18n.ts'
import { PersonFacts, type PersonFact } from '../iam/person-facts.tsx'

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
  boneName: { width: 160, height: 24, borderRadius: 6 },
  boneMeta: { width: '100%', maxWidth: 240, height: 14, borderRadius: 4 },
})

export default function AccountHeader() {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const self = useQuery(query.self.getSelf.queryOptions())

  if (self.isError) return <Feedback message={formatError(self.error)} />
  const me = self.data
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
                  label: format(m.personPlacement),
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
