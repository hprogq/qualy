import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PageLink, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Feedback } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { initialsOf } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import {
  Card,
  CardEmpty,
  CardHead,
  DefLine,
  DefList,
  DetailSheet,
  FootNote,
  MetaLine,
  Spacer,
  Status,
  Tag,
} from '@qualy/ui/screen'
import { iamMessages as m } from '../../i18n.ts'
import { authApi } from '../../api.ts'
import { PlacementPath } from './PlacementPath.tsx'

// One person, looked at without leaving the roster.
//
// Read-only on purpose. Everything that can be done to somebody is done on
// their own page, and a second place to do some of it is a second place to
// keep right: the panel answers "who is this" and offers one way on.

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  face: {
    display: 'flex',
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    backgroundColor: tokens.surfaceMuted,
    color: tokens.surfaceMutedForeground,
    fontSize: 14,
    fontWeight: 600,
  },
  roleRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 9,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  roleName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontWeight: 500,
  },
  roleWhere: { flexShrink: 0, fontSize: 12, color: QUIET },
  aside: { fontSize: 12, color: QUIET },
  warn: { color: tokens.warningForeground },
  spacer: { flexGrow: 1 },
  lines: { display: 'flex', flexDirection: 'column', gap: 10, padding: 16 },
  line: { height: 14, borderRadius: 4 },
  lineShort: { width: '55%' },
})

export function PersonSheet({
  open,
  userId,
  onClose,
}: {
  /** false while it animates shut; it keeps drawing who it was showing */
  open: boolean
  userId: string
  onClose: () => void
}) {
  const query = useApiQuery(authApi)
  const { format, formatError, locale } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const detail = useQuery({
    ...query.identity.getUser.queryOptions({ params: { userId } }),
    enabled: userId !== '',
  })
  const person = detail.data
  const lastUsed = person?.identities
    .map((identity) => identity.lastUsedAt)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1)
  const whenWords = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      width="narrow"
      title={person?.user.displayName ?? format(commonMessages.loading)}
      titleAside={
        person?.user.userType == null ? undefined : <Tag>{person.user.userType.name}</Tag>
      }
      lead={
        <span aria-hidden {...stylex.props(styles.face)}>
          {person === undefined ? '' : initialsOf(person.user.displayName)}
        </span>
      }
      meta={
        person === undefined ? undefined : (
          // who, and nothing else: where they stand is said once, below
          <MetaLine items={[person.user.businessNo ?? format(m.personNoBusinessNo, { businessNo })]} />
        )
      }
      closeLabel={format(commonMessages.close)}
      testId="person-sheet"
      footer={
        <>
          <FootNote>{format(m.quickViewHint)}</FootNote>
          <Spacer />
          <Button size="sm" asChild>
            <PageLink page="auth/user-detail" params={{ userId }}>
              {format(m.personOpenDetail)}
            </PageLink>
          </Button>
        </>
      }
    >
      {detail.isError ? (
        <Feedback message={formatError(detail.error)} />
      ) : person === undefined ? (
        <Card>
          <div {...stylex.props(styles.lines)}>
            <Skeleton className={stylex.props(styles.line).className} />
            <Skeleton className={stylex.props(styles.line, styles.lineShort).className} />
            <Skeleton className={stylex.props(styles.line).className} />
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <DefList>
              <DefLine label={format(m.personStatus)}>
                <Status
                  tone={person.user.status === 'active' ? 'ok' : 'bad'}
                  data-testid="person-status"
                  data-status={person.user.status}
                >
                  {format(
                    person.user.status === 'deleted'
                      ? m.deletedBadge
                      : person.user.status === 'disabled'
                        ? m.disabledBadge
                        : m.statusActive,
                  )}
                </Status>
              </DefLine>
              <DefLine label={format(m.personUserType)}>
                {person.user.userType?.name ?? '—'}
              </DefLine>
              <DefLine label={format(m.personPlacement)}>
                <PlacementPath steps={person.orgPath} empty="—" />
              </DefLine>
              <DefLine label={format(m.accountsLabel)}>
                <span
                  {...stylex.props(person.user.identityCount === 0 && styles.warn)}
                  data-accounts={person.user.identityCount}
                >
                  {person.user.identityCount === 0
                    ? format(m.accountNone)
                    : format(m.accountCount, { count: person.user.identityCount })}
                </span>
                {person.user.identityCount > 0 && (
                  <span {...stylex.props(styles.aside)}>
                    {lastUsed === undefined
                      ? format(m.neverUsed)
                      : format(m.lastUsed, { when: whenWords(lastUsed) })}
                  </span>
                )}
              </DefLine>
            </DefList>
          </Card>
          {/* Two lists, because they are two kinds of authority: a duty held
              in the organization applies wherever it says, and one confined to
              a single object confers nothing outside it. Side by side in one
              list they read as the same thing. */}
          {(
            [
              ['organizational', m.personRoles, person.roles.filter((role) => !role.scoped)],
              ['confined', m.personRolesConfined, person.roles.filter((role) => role.scoped)],
            ] as const
          ).map(([kind, title, roles]) =>
            kind === 'confined' && roles.length === 0 ? null : (
              <Card key={kind} data-testid="person-roles" data-kind={kind} data-count={roles.length}>
                <CardHead title={format(title)} note={format(m.grantCount, { count: roles.length })} />
                {roles.length === 0 ? (
                  <CardEmpty>{format(m.personNoRoles)}</CardEmpty>
                ) : (
                  roles.map((role) => (
                    <div key={role.grantId} {...stylex.props(styles.roleRow)}>
                      <span {...stylex.props(styles.roleName)}>{role.roleName}</span>
                      <span {...stylex.props(styles.spacer)} />
                      <span {...stylex.props(styles.roleWhere)}>
                        {role.orgNodeName === null
                          ? format(m.personRoleTenantWide)
                          : format(
                              role.coverage === 'subtree' ? m.personRoleSubtree : m.personRoleHere,
                              { node: role.orgNodeName },
                            )}
                      </span>
                    </div>
                  ))
                )}
              </Card>
            ),
          )}
        </>
      )}
    </DetailSheet>
  )
}
