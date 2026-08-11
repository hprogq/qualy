import type { PeopleImportContext } from '@qualy/ui-contract'
import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Badge } from '@qualy/ui/badge'
import { CheckboxGroup } from '@qualy/ui/admin'
import { authApi } from '../api.ts'
import { authMessages as m } from '../i18n.ts'
import { OrgTree } from './OrgTree.tsx'

// Naming a slice of the organization instead of naming people.
//
// Clicking a unit adds it, clicking it again takes it back, and the whole
// subtree comes with it - which is the one place a unit stands in for its
// people. What that does is the asking screen's business: this only says
// which units and which kinds of person.

export default function PeopleImportPicker({ context }: { context: PeopleImportContext }) {
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))

  const nodes = options.data?.nodes ?? []
  const chosen = new Set(context.value.orgNodeIds)

  const toggle = (nodeId: string) => {
    const next = new Set(chosen)
    if (next.has(nodeId)) next.delete(nodeId)
    else next.add(nodeId)
    context.onChange({ ...context.value, orgNodeIds: [...next] })
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">{format(m.importUnits)}</p>
        <div className="max-h-64 overflow-auto rounded-md border p-1">
          <OrgTree
            nodes={nodes.map((row) => ({
              id: row.orgNodeId,
              name: row.name,
              parentId: row.parentId,
            }))}
            emptyLabel={format(m.pickerNoUnits)}
            expandLabel={format(m.pickerExpand)}
            marked={chosen}
            onSelect={(node) => toggle(node.id)}
          />
        </div>
        {options.data?.truncated === true && (
          <p className="text-xs text-muted-foreground">{format(commonMessages.moreResults)}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {nodes
            .filter((row) => chosen.has(row.orgNodeId))
            .map((row) => (
              <Badge key={row.orgNodeId} variant="secondary" className="font-normal">
                {row.name}
              </Badge>
            ))}
        </div>
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
