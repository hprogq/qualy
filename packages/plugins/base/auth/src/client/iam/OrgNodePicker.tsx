import { useMemo, useState } from 'react'
import { XIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { OrgNodePickerContext } from '@qualy/ui-contract'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Badge } from '@qualy/ui/badge'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { TreeSelect } from '@qualy/ui/tree-select'
import { authApi } from '../api.ts'
import { authMessages as m } from '../i18n.ts'

// Units, chosen as a set.
//
// Two ways of looking at the same thing. The tree is how somebody finds a
// unit they can point to; searching or filtering by kind turns it into a flat
// list, because a tree filtered down to its matches is mostly the branches
// that lead to them - and "every class in the college" is a list, not a
// shape.
//
// Ticking a unit covers everything under it, and unticking one class of a
// ticked year leaves the other classes ticked (the arithmetic lives in
// @qualy/ui's tree-selection and is tested there). Selection is always a set:
// one person over two classes and two people over one are the same errand.

export default function OrgNodePicker({ context }: { context: OrgNodePickerContext }) {
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  const [search, setSearch] = useState('')
  const [orgTypeId, setOrgTypeId] = useState('')

  const supplied = context.nodes !== undefined
  const options = useQuery({
    ...query.identity.getUserOptions.queryOptions({ query: {} }),
    enabled: !supplied,
  })

  const nodes = useMemo(
    () =>
      context.nodes ??
      (options.data?.nodes ?? []).map((row) => ({
        id: row.orgNodeId,
        name: row.name,
        parentId: row.parentId,
        orgTypeId: row.orgTypeId,
      })),
    [context.nodes, options.data],
  )
  const typeNames = useMemo(
    () => new Map((options.data?.orgTypes ?? []).map((type) => [type.id, type.name])),
    [options.data],
  )
  const kindOf = (node: { orgTypeId?: string }) =>
    node.orgTypeId === undefined ? undefined : typeNames.get(node.orgTypeId)

  const filtering = search.trim() !== '' || orgTypeId !== ''
  const matches = nodes.filter(
    (node) =>
      (search.trim() === '' || node.name.toLowerCase().includes(search.trim().toLowerCase())) &&
      (orgTypeId === '' || node.orgTypeId === orgTypeId),
  )
  const chosen = new Set(context.value)
  const named = new Map(nodes.map((node) => [node.id, node.name]))

  const badge = (node: { id: string }) => {
    const kind = kindOf(nodes.find((row) => row.id === node.id) ?? {})
    return kind === undefined ? null : (
      <Badge variant="outline" className="shrink-0 font-normal">
        {kind}
      </Badge>
    )
  }

  const toggle = (nodeId: string) => {
    const next = new Set(chosen)
    if (next.has(nodeId)) next.delete(nodeId)
    else next.add(nodeId)
    context.onChange([...next])
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={format(m.nodeSearch)}
          className="h-8 min-w-40 flex-1"
        />
        {typeNames.size > 0 && (
          <NativeSelect
            value={orgTypeId}
            onChange={(event) => setOrgTypeId(event.target.value)}
            className="h-8 w-auto"
            aria-label={format(m.nodeKind)}
          >
            <option value="">{format(m.nodeAnyKind)}</option>
            {[...typeNames.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      <div className="max-h-64 overflow-auto rounded-md border p-1">
        {filtering ? (
          matches.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{format(m.nodeNoMatch)}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {matches.map((node) => (
                <li key={node.id}>
                  <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                    <Checkbox
                      checked={chosen.has(node.id)}
                      onCheckedChange={() => toggle(node.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{node.name}</span>
                    {badge(node)}
                  </label>
                </li>
              ))}
            </ul>
          )
        ) : (
          <TreeSelect
            value={context.value}
            onChange={context.onChange}
            nodes={nodes}
            emptyLabel={format(m.pickerNoUnits)}
            meta={badge}
          />
        )}
      </div>

      {!supplied && options.data?.truncated === true && (
        <p className="text-xs text-muted-foreground">{format(commonMessages.moreResults)}</p>
      )}

      {context.value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {context.value.map((nodeId) => (
            <Badge key={nodeId} variant="secondary" className="gap-1 font-normal">
              {named.get(nodeId) ?? nodeId}
              <button
                type="button"
                aria-label={format(m.nodeRemove, { name: named.get(nodeId) ?? '' })}
                onClick={() => toggle(nodeId)}
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
