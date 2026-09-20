import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { authApi } from '../../api.ts'

// What is true of a user type that the type itself does not hold: which
// entrances admit it, which roles it may carry, and what its allowed kinds of
// unit are called. Each comes from the screen that owns it, so a reader
// without that screen's permission sees the fact as unknown rather than as
// empty - `undefined` is "cannot say", an empty list is "none".

type UserTypeLike = {
  readonly id: string
  readonly placementPolicy:
    | { readonly mode: 'unrestricted' }
    | { readonly mode: 'tenant-root' }
    | { readonly mode: 'allow-list'; readonly orgTypeIds: readonly string[] }
}

export function useUserTypeFacts() {
  const query = useApiQuery(authApi)
  // its own options endpoint, so administering types needs no permission over
  // the organization
  const catalog = useQuery(query.identity.getUserTypeOptions.queryOptions())
  const providers = useQuery({
    ...query.identity.listAuthProviders.queryOptions(),
    retry: false,
  })
  const roles = useQuery({ ...query.access.listRoles.queryOptions({ query: {} }), retry: false })

  return {
    catalog,
    orgTypes: catalog.data?.orgTypes ?? [],
    /** the kinds of unit an allow-list names, in the catalog's order */
    allowedKinds: (type: UserTypeLike) => {
      const policy = type.placementPolicy
      if (policy.mode !== 'allow-list') return []
      return (catalog.data?.orgTypes ?? [])
        .filter((orgType) => policy.orgTypeIds.includes(orgType.id))
        .map((orgType) => orgType.name)
    },
    /** every entrance in service, and whether it lets this type through */
    entrances: (type: UserTypeLike) =>
      providers.data?.providers
        .filter((provider) => provider.status === 'active')
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          audience: provider.audience,
          admits:
            provider.audience.mode === 'unrestricted' ||
            provider.audience.userTypeIds.includes(type.id),
        })),
    /** the roles in service this type may carry */
    openRoles: (type: UserTypeLike) =>
      roles.data?.roles.filter(
        (role) =>
          role.status === 'active' &&
          (role.holderPolicy.mode === 'unrestricted' ||
            role.holderPolicy.userTypeIds.includes(type.id)),
      ),
  }
}
