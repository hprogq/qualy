import { useMemo, useState } from 'react'
import { XIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { OrgNodePickerContext } from '@qualy/ui-contract'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Badge } from '@qualy/ui/badge'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Skeleton } from '@qualy/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { TreeSelect } from '@qualy/ui/tree-select'
import { OrgTree } from './OrgTree.tsx'
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

// a select cannot hold the empty string as a value, so "any" needs a word
const ANY = 'any'

const styles = stylex.create({
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  searchInput: {
    height: 32,
    width: '100%',
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  pinned: {
    flexShrink: 0,
  },
  quietBadge: {
    fontWeight: 400,
  },
  chosenBadge: {
    gap: 4,
    fontWeight: 400,
  },
  listBox: {
    overflow: 'auto',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 4,
  },
  listBoxTall: {
    height: 'calc(100dvh - 24rem)',
    minHeight: '14rem',
  },
  listBoxShort: {
    height: '42vh',
    minHeight: '16rem',
  },
  skeletonStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 8,
  },
  bone: { height: 24 },
  boneWide: { width: '66%' },
  boneHalf: { width: '50%' },
  boneMid: { width: '60%' },
  boneNarrow: { width: '40%' },
  quietNote: {
    padding: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  flatList: {
    display: 'flex',
    width: 'max-content',
    minWidth: '100%',
    flexDirection: 'column',
    gap: 2,
  },
  flatRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderRadius: tokens.radiusMd,
    paddingInline: 8,
    paddingBlock: 6,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    whiteSpace: 'nowrap',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  moreNote: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  chosenRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  removeGlyph: {
    width: 12,
    height: 12,
  },
  kindField: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
})

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

  // supplied units arrive with whoever opened the picker, and only they know
  // whether they are still fetching them
  const loading = supplied ? context.loading === true : options.isPending
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
      <Badge variant="outline" className={stylex.props(styles.pinned, styles.quietBadge).className}>
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
    <div {...stylex.props(styles.stack)}>
      {/* the search takes the whole width and the two narrow controls share
          the next line: side by side in a pane this wide, the last one was
          forever being pushed onto a line of its own */}
      <div {...stylex.props(styles.stack)}>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={format(m.nodeSearch)}
          className={stylex.props(styles.searchInput).className}
        />
        {(context.scope !== undefined || typeNames.size > 0) && (
          <div {...stylex.props(styles.filterRow)}>
            {context.scope !== undefined && (
              <ToggleGroup
                type="single"
                spacing={0}
                value={context.scope}
                onValueChange={(next) =>
                  next && context.onScopeChange?.(next as 'self' | 'subtree')
                }
                variant="outline"
                size="sm"
                className={stylex.props(styles.pinned).className}
              >
                <ToggleGroupItem value="self">{format(m.pickerScopeSelf)}</ToggleGroupItem>
                <ToggleGroupItem value="subtree">{format(m.pickerScopeSubtree)}</ToggleGroupItem>
              </ToggleGroup>
            )}
            {typeNames.size > 0 && (
              <Select
                value={orgTypeId === '' ? ANY : orgTypeId}
                onValueChange={(next) => setOrgTypeId(next === ANY ? '' : next)}
              >
                <SelectTrigger size="sm" xstyle={styles.kindField} aria-label={format(m.nodeKind)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{format(m.nodeAnyKind)}</SelectItem>
                  {[...typeNames.entries()].map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      <div
        {...stylex.props(
          styles.listBox,
          context.fill === true ? styles.listBoxTall : styles.listBoxShort,
        )}
      >
        {loading ? (
          // a fixed height and a skeleton, because the alternative is an
          // empty box that grows to a tree and shoves the dialog around
          <div {...stylex.props(styles.skeletonStack)}>
            <Skeleton className={stylex.props(styles.bone, styles.boneWide).className} />
            <Skeleton className={stylex.props(styles.bone, styles.boneHalf).className} />
            <Skeleton className={stylex.props(styles.bone, styles.boneMid).className} />
            <Skeleton className={stylex.props(styles.bone, styles.boneNarrow).className} />
          </div>
        ) : context.single === true ? (
          // no checkbox and no cover arithmetic: one unit, clicked, and the
          // whole row is the target - which is also how a name five levels
          // down keeps enough width to be read
          <OrgTree
            nodes={filtering ? matches : nodes}
            emptyLabel={format(filtering ? m.nodeNoMatch : m.pickerNoUnits)}
            expandLabel={format(m.pickerExpand)}
            selected={context.value[0] ?? null}
            flat={filtering}
            meta={badge}
            onSelect={(node) => context.onChange(context.value[0] === node.id ? [] : [node.id])}
          />
        ) : filtering ? (
          matches.length === 0 ? (
            <p {...stylex.props(styles.quietNote)}>{format(m.nodeNoMatch)}</p>
          ) : (
            <ul {...stylex.props(styles.flatList)}>
              {matches.map((node) => (
                <li key={node.id}>
                  <label {...stylex.props(styles.flatRow)}>
                    <Checkbox
                      checked={chosen.has(node.id)}
                      onCheckedChange={() => toggle(node.id)}
                    />
                    <span>{node.name}</span>
                    {badge(node)}
                    <span {...stylex.props(styles.spacer)} />
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
        <p {...stylex.props(styles.moreNote)}>{format(commonMessages.moreResults)}</p>
      )}

      {context.value.length > 0 && (
        <div {...stylex.props(styles.chosenRow)}>
          {context.value.map((nodeId) => (
            <Badge
              key={nodeId}
              variant="secondary"
              className={stylex.props(styles.chosenBadge).className}
            >
              {named.get(nodeId) ?? nodeId}
              <button
                type="button"
                aria-label={format(m.nodeRemove, { name: named.get(nodeId) ?? '' })}
                onClick={() => toggle(nodeId)}
              >
                <XIcon className={stylex.props(styles.removeGlyph).className} />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
