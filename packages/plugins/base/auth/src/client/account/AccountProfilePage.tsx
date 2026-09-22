import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { AsyncSection } from '@qualy/ui/admin'
import { Card, DefLine, DefList, EditorSkeleton, SectionHead } from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { EmailWithStanding } from '../iam/person-facts.tsx'

// The reader, as the product has them on file: the same facts an
// administrator reads on their record, and nothing to change here - the
// directory is kept by whoever administers it.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
})

export default function AccountProfilePage() {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const self = useQuery(query.self.getSelf.queryOptions())
  const me = self.data

  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead title={format(m.accountProfile)} />
      <AsyncSection
        pending={self.isPending}
        error={self.isError ? formatError(self.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void self.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {me && (
          <Card data-testid="account-profile">
            <DefList>
              <DefLine label={format(m.nameLabel)}>{me.displayName}</DefLine>
              <DefLine label={businessNoWord}>
                {me.businessNo ?? format(m.personNoBusinessNo, { businessNo: businessNoWord })}
              </DefLine>
              <DefLine label={format(m.emailLabel)}>
                <EmailWithStanding email={me.email} verified={me.emailVerified} />
              </DefLine>
              <DefLine label={format(m.userTypeLabel)}>{me.userType.name}</DefLine>
              <DefLine label={format(m.anchorLabel)}>
                {me.unit?.name ?? format(m.rolesNone)}
              </DefLine>
            </DefList>
          </Card>
        )}
      </AsyncSection>
    </div>
  )
}
