import { useQuery } from '@tanstack/react-query'
import { PageLink, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { BandBack, EditorSkeleton, Screen } from '@qualy/ui/screen'
import { rbacMessages as m } from './i18n.ts'
import { RoleEditor } from './RoleEditor.tsx'
import { accessApi } from './api.ts'

// One role's own page, reached from its row in the list.
//
// The role is read from the same list the page before it drew - so opening a
// row costs no request, and every save that refreshes the list refreshes
// this too - and what may be done to it comes from the same answer.

export default function RolePage() {
  const { roleId } = usePageRouteParams('roleId')
  const query = useApiQuery(accessApi)
  const { format, formatError } = useI18n()
  const roles = useQuery(query.access.listRoles.queryOptions({ query: {} }))
  const role = roles.data?.roles.find((candidate) => candidate.id === roleId)

  if (role !== undefined) {
    return (
      <RoleEditor
        key={role.id}
        role={role}
        canManage={roles.data?.capabilities.canManage ?? false}
      />
    )
  }
  return (
    <Screen
      back={
        <BandBack as={PageLink} page="rbac/roles">
          {format(m.backToRoles)}
        </BandBack>
      }
      title={format(m.editRole)}
    >
      <AsyncSection
        pending={roles.isPending}
        error={
          roles.isError ? formatError(roles.error) : roles.isSuccess ? format(m.roleGone) : null
        }
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void roles.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {null}
      </AsyncSection>
    </Screen>
  )
}
