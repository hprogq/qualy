import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, useLoadFailure } from '@qualy/web-runtime'

import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { AsyncSection } from '@qualy/ui/admin'
import { Card, DefLine, DefList, DefListSkeleton, SectionHead } from '@qualy/ui/screen'

import { authApi } from '../api.ts'
import { EmailWithStanding } from '../iam/person-facts.tsx'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// The reader, as the product has them on file: the same facts an
// administrator reads on their record, and nothing to change here - the
// directory is kept by whoever administers it.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
  // where they stand, from the top down: the units above in grey, their own in ink
  lineage: { display: 'inline', lineHeight: 1.6 },
  step: { color: tokens.mutedForeground },
  here: { color: tokens.foreground },
  slash: { paddingInline: 6, color: tokens.mutedForeground },
})

export default function AccountProfilePage() {
  const query = useApiQuery(authApi)

  const describe = useLoadFailure()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const self = useQuery(query.self.getSelf.queryOptions())
  const me = self.data

  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead title={m.account_profile()} />
      <AsyncSection
        pending={self.isPending}
        error={self.isError ? describe.of(self.error) : null}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => void self.refetch()}
        skeleton={
          <Card>
            <DefListSkeleton rows={5} />
          </Card>
        }
      >
        {me && (
          <Card data-testid="account-profile">
            <DefList>
              <DefLine label={m.field_name()}>{me.displayName}</DefLine>
              <DefLine label={businessNoWord}>
                {me.businessNo ?? m.person_noBusinessNo({ businessNo: businessNoWord })}
              </DefLine>
              <DefLine label={m.users_email()}>
                <EmailWithStanding email={me.email} verified={me.emailVerified} />
              </DefLine>
              <DefLine label={m.field_userType()}>{me.userType.name}</DefLine>
              <DefLine label={m.users_anchor()}>
                {me.unitLineage.length === 0 ? (
                  (me.unit?.name ?? m.users_rolesNone())
                ) : (
                  <span data-testid="unit-lineage" {...stylex.props(styles.lineage)}>
                    {me.unitLineage.map((step, index) => {
                      const last = index === me.unitLineage.length - 1
                      return (
                        <span key={step.id}>
                          {index > 0 && (
                            <span aria-hidden {...stylex.props(styles.slash)}>
                              /
                            </span>
                          )}
                          <span
                            data-here={last || undefined}
                            {...stylex.props(last ? styles.here : styles.step)}
                          >
                            {step.name}
                          </span>
                        </span>
                      )
                    })}
                  </span>
                )}
              </DefLine>
            </DefList>
          </Card>
        )}
      </AsyncSection>
    </div>
  )
}
