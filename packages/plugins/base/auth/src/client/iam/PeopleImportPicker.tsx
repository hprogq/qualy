import type { PeopleImportContext } from '@qualy/ui-contract'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { CheckboxGroup } from '@qualy/ui/admin'
import { authApi } from '../api.ts'
import { authMessages as m } from '../i18n.ts'
import OrgNodePicker from './OrgNodePicker.tsx'

// Naming a slice of the organization instead of naming people.
//
// The units come from the same picker every other screen uses - tree, search,
// filter by kind, ticking one covers everything under it - and the kinds of
// person are the other half of the query. What running it does is the asking
// screen's business.

export default function PeopleImportPicker({ context }: { context: PeopleImportContext }) {
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">{format(m.importUnits)}</p>
        <OrgNodePicker
          context={{
            value: context.value.orgNodeIds,
            onChange: (orgNodeIds) => context.onChange({ ...context.value, orgNodeIds }),
          }}
        />
      </div>

      <CheckboxGroup
        legend={format(m.importTypes)}
        options={(options.data?.userTypes ?? []).map((type) => ({
          value: type.id,
          label: type.name,
        }))}
        selected={[...context.value.userTypeIds]}
        onChange={(userTypeIds) => context.onChange({ ...context.value, userTypeIds })}
        emptyLabel={format(m.importNoTypes)}
      />
    </div>
  )
}
