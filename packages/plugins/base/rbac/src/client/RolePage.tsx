import { useQuery } from '@tanstack/react-query'
import {
  LoadFailure,
  PageLink,
  useApiQuery,
  useLoadFailure,
  usePageRouteParams,
} from '@qualy/web-runtime'

import { BandBack, EditorSkeleton, Screen } from '@qualy/ui/screen'

import { RoleEditor } from './RoleEditor.tsx'
import { accessApi } from './api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One role's own page, reached from its row in the list.
//
// The role is read from the same list the page before it drew - so opening a
// row costs no request, and every save that refreshes the list refreshes
// this too - and what may be done to it comes from the same answer.
//
// A role the list does not hold is not there, and a list that could not be
// read has nothing to say about any role: either way the page is the state,
// with no heading of a role standing over it.

export default function RolePage() {
  const { roleId } = usePageRouteParams('roleId')
  const query = useApiQuery(accessApi)

  const describe = useLoadFailure()
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
  if (roles.data !== undefined || roles.isError) {
    return (
      <LoadFailure
        failure={
          roles.data !== undefined
            ? describe.missing({ copy: { missing: { title: m.roles_gone() } } })
            : describe.of(roles.error)
        }
        onRetry={() => void roles.refetch()}
        retrying={roles.isFetching}
        back={{ page: 'rbac/roles', label: m.roles_back() }}
      />
    )
  }
  return (
    <Screen
      back={
        <BandBack as={PageLink} page="rbac/roles">
          {m.roles_back()}
        </BandBack>
      }
      title={m.roles_edit()}
    >
      <div role="status" aria-label={commonMessages.state_loading()}>
        <EditorSkeleton />
      </div>
    </Screen>
  )
}
