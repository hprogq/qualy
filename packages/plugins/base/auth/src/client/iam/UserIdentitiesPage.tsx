import { useQuery } from '@tanstack/react-query'
import { KeyRoundIcon } from 'lucide-react'
import { PageLink, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection } from '@qualy/ui/admin'
import { Blank, EditorSkeleton, SectionHead } from '@qualy/ui/screen'
import { Badge } from '@qualy/ui/badge'
import { Stagger } from '@qualy/ui/reveal'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// The ways in that are bound to the person: through which doors they can
// sign in, and when they last did. The doors themselves are administered on
// their own screen; this says which of them this person holds.

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  manageLink: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    textDecoration: {
      default: 'none',
      ':hover': 'underline',
    },
  },
  compactBlank: {
    minHeight: '14rem',
  },
  entranceList: {
    minWidth: 0,
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  entranceRow: {
    display: 'grid',
    minWidth: 0,
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 16,
    paddingInline: 16,
    paddingBlock: 12,
  },
  // the hairline between rows is index state: the stagger wraps each row,
  // so there is no usable first-child to key a divider on
  entranceRowDivided: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  entranceWho: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  entranceName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  entranceId: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: '0.75rem',
    color: tokens.mutedForeground,
  },
  entranceWhen: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  pinned: {
    flexShrink: 0,
  },
  alert: {
    color: tokens.danger,
  },
})

export default function UserIdentitiesPage() {
  const { userId } = usePageRouteParams('userId')
  const query = useApiQuery(authApi)
  const { format, formatError, locale } = useI18n()
  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const identities = user.data?.identities ?? []
  const lastUsed = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' })

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
        {user.data && (
          <>
            <SectionHead
              title={format(m.boundHeading)}
              count={format(m.boundCount, { count: identities.length })}
              actions={
                <PageLink
                  page="auth/login-methods"
                  className={stylex.props(styles.manageLink).className}
                  unavailable={null}
                >
                  {format(m.manageWaysIn)}
                </PageLink>
              }
            />
            {identities.length === 0 ? (
              <Blank
                icon={<KeyRoundIcon />}
                title={format(m.boundEmptyTitle)}
                description={format(m.boundEmptyBody)}
                xstyle={styles.compactBlank}
              />
            ) : (
              <Stagger className={stylex.props(styles.entranceList).className}>
                {identities.map((identity, at) => (
                  <div
                    key={identity.id}
                    data-entrance-status={identity.providerStatus}
                    {...stylex.props(styles.entranceRow, at > 0 && styles.entranceRowDivided)}
                  >
                    <span {...stylex.props(styles.entranceWho)}>
                      <span {...stylex.props(styles.entranceName)}>{identity.providerName}</span>
                      <Badge variant="secondary" className={stylex.props(styles.pinned).className}>
                        {format(identity.hasCredential ? m.localAccount : m.federatedAccount)}
                      </Badge>
                      {identity.providerStatus === 'disabled' && (
                        <Badge
                          variant="destructive"
                          className={stylex.props(styles.pinned).className}
                        >
                          {format(m.entranceDisabled)}
                        </Badge>
                      )}
                    </span>
                    <span {...stylex.props(styles.entranceId)}>{identity.identifier}</span>
                    <span
                      {...stylex.props(
                        styles.entranceWhen,
                        identity.lastUsedAt === null && styles.alert,
                      )}
                    >
                      {identity.lastUsedAt === null
                        ? format(m.neverUsed)
                        : format(m.lastUsed, { when: lastUsed(identity.lastUsedAt) })}
                    </span>
                  </div>
                ))}
              </Stagger>
            )}
          </>
        )}
      </AsyncSection>
    </div>
  )
}
