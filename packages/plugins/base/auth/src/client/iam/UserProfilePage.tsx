import { useQuery } from '@tanstack/react-query'
import { PageLink, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { EditorSkeleton, Facts, SectionHead } from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

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
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const record = user.data?.user
  const path = user.data?.orgPath ?? []
  const roles = user.data?.roles ?? []

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
              <Facts
                columns={3}
                items={[
                  { label: format(m.nameLabel), value: record.displayName },
                  {
                    label: businessNoWord,
                    value:
                      record.businessNo ??
                      format(m.personNoBusinessNo, { businessNo: businessNoWord }),
                  },
                  {
                    label: format(m.userTypeLabel),
                    value: record.userType?.name ?? format(m.rolesNone),
                  },
                  {
                    label: format(m.columnStatus),
                    value: format(
                      record.status === 'deleted'
                        ? m.deletedBadge
                        : record.status === 'disabled'
                          ? m.disabledBadge
                          : m.statusActive,
                    ),
                  },
                  {
                    label: format(m.personPlacement),
                    value:
                      path.length === 0
                        ? format(m.rolesNone)
                        : path.map((node) => node.name).join(' / '),
                  },
                  {
                    label: format(m.accountsLabel),
                    value:
                      record.identityCount === 0
                        ? format(m.accountNone)
                        : format(m.accountCount, { count: record.identityCount }),
                  },
                ]}
              />
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
              {roles.length === 0 ? (
                <p {...stylex.props(styles.quiet)}>{format(m.personNoRoles)}</p>
              ) : (
                <ul {...stylex.props(styles.roleList)}>
                  {roles.map((role) => (
                    <li key={role.grantId} {...stylex.props(styles.roleRow)}>
                      <span {...stylex.props(styles.roleName)}>{role.roleName}</span>
                      <span {...stylex.props(styles.roleWhere)}>
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
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </AsyncSection>
    </div>
  )
}
