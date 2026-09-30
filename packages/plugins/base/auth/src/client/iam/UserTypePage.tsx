import { useQuery } from '@tanstack/react-query'
import {
  LoadFailure,
  PageLink,
  useApiQuery,
  useLoadFailure,
  usePageRouteParams,
} from '@qualy/web-runtime'

import { BandBack, EditorSkeleton, Screen } from '@qualy/ui/screen'

import { UserTypeConfig } from './types/UserTypeConfig.tsx'
import { authApi } from '../api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One user type's own page, reached from its row in the list.
//
// The type is read from the same list the page before it drew - so opening a
// row costs no request, and every save that refreshes the list refreshes
// this too - and what may be done to it comes from the same answer.
//
// A type the list does not hold is not there, and a list that could not be
// read has nothing to say about any type: either way the page is the state,
// with no heading of a type standing over it.

export default function UserTypePage() {
  const { typeId } = usePageRouteParams('typeId')
  const query = useApiQuery(authApi)

  const describe = useLoadFailure()
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
  if (types.data !== undefined || types.isError) {
    return (
      <LoadFailure
        failure={
          types.data !== undefined
            ? describe.missing({ copy: { missing: { title: m.userTypes_gone() } } })
            : describe.of(types.error)
        }
        onRetry={() => void types.refetch()}
        retrying={types.isFetching}
        back={{ page: 'auth/user-types', label: m.userTypes_back() }}
      />
    )
  }
  return (
    <Screen
      back={
        <BandBack as={PageLink} page="auth/user-types">
          {m.userTypes_back()}
        </BandBack>
      }
      title={m.userTypes_edit()}
    >
      <div role="status" aria-label={commonMessages.state_loading()}>
        <EditorSkeleton />
      </div>
    </Screen>
  )
}
