import { useQuery } from '@tanstack/react-query'
import { PageLink, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { BandBack, EditorSkeleton, Screen } from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { UserTypeConfig } from './types/UserTypeConfig.tsx'
import { authApi } from '../api.ts'

// One user type's own page, reached from its row in the list.
//
// The type is read from the same list the page before it drew - so opening a
// row costs no request, and every save that refreshes the list refreshes
// this too - and what may be done to it comes from the same answer.

export default function UserTypePage() {
  const { typeId } = usePageRouteParams('typeId')
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const types = useQuery(query.identity.listUserTypes.queryOptions({}))
  const userType = types.data?.userTypes.find((candidate) => candidate.id === typeId)

  if (userType !== undefined) {
    return (
      <UserTypeConfig
        key={userType.id}
        userType={userType}
        canManage={types.data?.capabilities.canManage ?? false}
      />
    )
  }
  return (
    <Screen
      back={
        <BandBack as={PageLink} page="auth/user-types">
          {format(m.backToUserTypes)}
        </BandBack>
      }
      title={format(m.editUserType)}
    >
      <AsyncSection
        pending={types.isPending}
        error={
          types.isError ? formatError(types.error) : types.isSuccess ? format(m.userTypeGone) : null
        }
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void types.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {null}
      </AsyncSection>
    </Screen>
  )
}
