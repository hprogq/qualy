import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageLink, useApi, useApiQuery, usePageRouteParams, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import {
  Card,
  CardEmpty,
  Cell,
  DefLine,
  DefList,
  EditorSkeleton,
  SectionHead,
  Status,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { PlacementPath } from './users/PlacementPath.tsx'
import { EmailWithStanding } from './person-facts.tsx'
import { AccountFieldDialog } from './users/AccountFieldDialog.tsx'

// The person, stated: what the directory holds about them, and where each
// of the other sections picks up. Editing is the banner's, because it edits
// the person and not a section of them.

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  // the address and whether it was proved, on one line
  roleList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  roleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  roleName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  roleWhere: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  quiet: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  // what the line says, and at its far end the way to change it
  valueLine: {
    display: 'flex',
    flexGrow: 1,
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
  },
  missing: { color: tokens.warningForeground },
  lineActions: { display: 'flex', gap: 4, marginInlineStart: 'auto' },
  aside: { fontSize: 12, color: tokens.mutedForeground },
  link: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    textDecoration: {
      default: 'none',
      ':hover': 'underline',
    },
  },
})

export default function UserProfilePage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const record = user.data?.user
  const path = user.data?.orgPath ?? []
  const roles = user.data?.roles ?? []
  // the account's fields are set here only by somebody who may change the
  // account, and never the system account's, which is provisioned
  const system = user.data?.placement.mode === 'tenant-root'
  const accountFields = (user.data?.accountManageable ?? false) && !system
  const [setting, setSetting] = useState<'email' | 'businessNo' | null>(null)
  const sendVerification = useMutation({
    mutationFn: (email: string) =>
      run(api.identity.createUserEmailVerification({ params: { userId } })).then((answer) => ({
        ...answer,
        email,
      })),
    onSuccess: async ({ sent, email }) => {
      if (sent) toast.success(format(m.personVerificationSent, { email }))
      else {
        // proven meanwhile: the page says so once it reads the person again
        toast.success(format(m.personAlreadyVerified))
        await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      }
    },
    onError: (error: unknown) => toast.error(formatError(error)),
  })
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))

  return (
    <div {...stylex.props(styles.page)}>
      <AsyncSection
        pending={user.isPending}
        error={user.isError ? formatError(user.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void user.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {record && (
          <>
            <section {...stylex.props(styles.section)}>
              <SectionHead title={format(m.profileSection)} />
              <Card data-testid="person-profile">
                <DefList>
                  <DefLine label={format(m.nameLabel)}>{record.displayName}</DefLine>
                  <DefLine label={businessNoWord}>
                    <span
                      data-testid="profile-business-no"
                      data-state={record.businessNo === null ? 'none' : 'set'}
                      data-warn={record.businessNo === null && !system ? 'yes' : 'no'}
                      {...stylex.props(styles.valueLine)}
                    >
                      {record.businessNo === null ? (
                        // a gap only where somebody could fill it: the
                        // platform's own account never gets a number
                        <span {...stylex.props(system ? styles.aside : styles.missing)}>
                          {format(m.fieldUnset)}
                        </span>
                      ) : (
                        record.businessNo
                      )}
                      {accountFields && (
                        <span {...stylex.props(styles.lineActions)}>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setSetting('businessNo')}
                          >
                            {format(
                              record.businessNo === null ? m.fieldSetAction : m.fieldChangeAction,
                            )}
                          </Button>
                        </span>
                      )}
                    </span>
                  </DefLine>
                  <DefLine label={format(m.emailLabel)}>
                    <span
                      data-testid="profile-email"
                      data-email-state={
                        record.email === null
                          ? 'none'
                          : record.emailVerifiedAt === null
                            ? 'unverified'
                            : 'verified'
                      }
                      {...stylex.props(styles.valueLine)}
                    >
                      {record.email === null ? (
                        <span {...stylex.props(styles.missing)}>{format(m.fieldUnset)}</span>
                      ) : (
                        <EmailWithStanding
                          email={record.email}
                          verified={record.emailVerifiedAt !== null}
                        />
                      )}
                      {accountFields ? (
                        <span {...stylex.props(styles.lineActions)}>
                          {/* the person proves it by following a link; the
                              administrator can only have one sent */}
                          {record.email !== null && record.emailVerifiedAt === null && (
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={sendVerification.isPending}
                              onClick={() => sendVerification.mutate(record.email!)}
                            >
                              {format(m.sendVerification)}
                            </Button>
                          )}
                          <Button size="xs" variant="ghost" onClick={() => setSetting('email')}>
                            {format(record.email === null ? m.fieldSetAction : m.fieldChangeAction)}
                          </Button>
                        </span>
                      ) : (
                        system && (
                          <span {...stylex.props(styles.aside)}>{format(m.emailSystemShort)}</span>
                        )
                      )}
                    </span>
                  </DefLine>
                  <DefLine label={format(m.userTypeLabel)}>{record.userType.name}</DefLine>
                  <DefLine label={format(m.columnStatus)}>
                    <Status tone={record.status === 'active' ? 'ok' : 'bad'}>
                      {format(record.status === 'disabled' ? m.disabledBadge : m.statusActive)}
                    </Status>
                  </DefLine>
                  <DefLine label={format(m.personPlacement)}>
                    <PlacementPath steps={path} empty={format(m.rolesNone)} />
                  </DefLine>
                  <DefLine label={format(m.lastSignInLabel)}>
                    {user.data?.lastSignInAt == null
                      ? format(m.neverUsed)
                      : when(user.data.lastSignInAt)}
                  </DefLine>
                </DefList>
              </Card>
            </section>

            <section {...stylex.props(styles.section)}>
              <SectionHead
                title={format(m.rolesLabel)}
                count={roles.length}
                actions={
                  <PageLink
                    page="rbac/user-role-grants"
                    params={{ userId }}
                    className={stylex.props(styles.link).className}
                    unavailable={null}
                  >
                    {format(m.manageRoles)}
                  </PageLink>
                }
              />
              <Card data-testid="person-roles" data-count={roles.length}>
                {roles.length === 0 ? (
                  <CardEmpty>{format(m.personNoRoles)}</CardEmpty>
                ) : (
                  <Table columns="minmax(0, 1fr) minmax(0, 1.4fr)">
                    <TableHead>
                      <span>{format(m.rolesLabel)}</span>
                      <span>{format(m.columnUnit)}</span>
                    </TableHead>
                    {roles.map((role) => (
                      <TableRow key={role.grantId} height="compact">
                        <Cell lead>{role.roleName}</Cell>
                        <Cell>
                          {role.scoped
                            ? format(m.personRoleScoped)
                            : role.orgNodeName === null
                              ? format(m.personRoleTenantWide)
                              : format(
                                  role.coverage === 'subtree'
                                    ? m.personRoleSubtree
                                    : m.personRoleHere,
                                  { node: role.orgNodeName },
                                )}
                        </Cell>
                      </TableRow>
                    ))}
                  </Table>
                )}
              </Card>
            </section>
          </>
        )}
      </AsyncSection>
      {setting !== null && record && (
        <AccountFieldDialog
          userId={userId}
          field={setting}
          current={setting === 'email' ? record.email : record.businessNo}
          version={record.version}
          onClose={() => setSetting(null)}
        />
      )}
    </div>
  )
}
