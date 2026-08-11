import { useQuery } from '@tanstack/react-query'
import type { OrgNodePickerContext } from '@qualy/ui-contract'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { authApi } from '../api.ts'
import { authMessages as m } from '../i18n.ts'
import { OrgTree } from './OrgTree.tsx'

// One unit, chosen from a tree.
//
// The units may be supplied by whoever opened it - a batch offers the ones it
// covers rather than the whole organization - and when they are not, they are
// the ones this reader may administer. Either way the tree looks and behaves
// the same, which is the point of it living here.

export default function OrgNodePicker({ context }: { context: OrgNodePickerContext }) {
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  const supplied = context.nodes !== undefined
  const options = useQuery({
    ...query.identity.getUserOptions.queryOptions({ query: {} }),
    enabled: !supplied,
  })

  const nodes =
    context.nodes ??
    (options.data?.nodes ?? []).map((row) => ({
      id: row.orgNodeId,
      name: row.name,
      parentId: row.parentId,
    }))

  return (
    <div className="space-y-2">
      <div className="max-h-56 overflow-auto rounded-md border p-1">
        <OrgTree
          nodes={nodes}
          emptyLabel={format(m.pickerNoUnits)}
          expandLabel={format(m.pickerExpand)}
          selected={context.value}
          onSelect={(node) => context.onChange(node.id)}
        />
      </div>
      {!supplied && options.data?.truncated === true && (
        <p className="text-xs text-muted-foreground">{format(commonMessages.moreResults)}</p>
      )}
    </div>
  )
}
