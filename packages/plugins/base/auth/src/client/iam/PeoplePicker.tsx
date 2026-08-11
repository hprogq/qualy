import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import type { PeoplePickerContext } from '@qualy/ui-contract'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { PersonCell } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { authApi } from '../api.ts'
import { authMessages as m } from '../i18n.ts'
import { OrgTree } from './OrgTree.tsx'

// Choosing people, from the side that owns them.
//
// The organization is on the left because that is how somebody who does not
// know a name finds one; the people standing there are on the right, one page
// at a time, because a university is not a list anybody scrolls. What is
// chosen is people - ticking a unit would be choosing a shape, and the shape
// changes underneath afterwards.
//
// Everything it can show is what the server will show it: the tree is the
// caller's own reach and the list is filtered by the same authority, so this
// screen has no idea a wider organization exists.

const PAGE = 25

export default function PeoplePicker({ context }: { context: PeoplePickerContext }) {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()

  const [node, setNode] = useState<{ id: string; name: string } | null>(null)
  const [scope, setScope] = useState<'self' | 'subtree'>('subtree')
  const [userTypeId, setUserTypeId] = useState('')
  const [search, setSearch] = useState('')
  const [settled, setSettled] = useState('')
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined])
  const [at, setAt] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    // a different question deserves a first page
    setCursors([undefined])
    setAt(0)
  }, [settled, scope, userTypeId, node?.id])

  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  const nodes = options.data?.nodes ?? []
  const here = node ?? (nodes[0] ? { id: nodes[0].orgNodeId, name: nodes[0].name } : null)

  const people = useQuery({
    ...query.identity.listUsers.queryOptions({
      query: {
        orgNodeId: here?.id ?? '',
        scope,
        ...(settled !== '' ? { search: settled } : {}),
        ...(userTypeId !== '' ? { userTypeId } : {}),
        ...(cursors[at] !== undefined ? { cursor: cursors[at] } : {}),
        limit: String(PAGE),
      },
    }),
    enabled: here !== null,
  })

  const nextCursor = people.data?.nextCursor ?? null
  useEffect(() => {
    if (nextCursor === null || cursors[at + 1] === nextCursor) return
    setCursors((current) => [...current.slice(0, at + 1), nextCursor])
  }, [nextCursor, at, cursors])

  const chosen = new Set(context.value)
  const blocked = new Set(context.disabled ?? [])
  const rows = people.data?.items ?? []

  const toggle = (userId: string) => {
    if (blocked.has(userId)) return
    if (context.single === true) {
      context.onChange(chosen.has(userId) ? [] : [userId])
      return
    }
    const next = new Set(chosen)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    context.onChange([...next])
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">{format(m.pickerUnits)}</p>
        <div className="max-h-80 overflow-auto rounded-md border p-1">
          <OrgTree
            nodes={nodes.map((row) => ({
              id: row.orgNodeId,
              name: row.name,
              parentId: row.parentId,
            }))}
            emptyLabel={format(m.pickerNoUnits)}
            expandLabel={format(m.pickerExpand)}
            selected={here?.id ?? null}
            onSelect={(picked) => setNode({ id: picked.id, name: picked.name })}
          />
        </div>
        {options.data?.truncated === true && (
          <p className="text-xs text-muted-foreground">{format(commonMessages.moreResults)}</p>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={format(m.pickerSearch)}
            className="h-8 min-w-40 flex-1"
          />
          <NativeSelect
            value={userTypeId}
            onChange={(event) => setUserTypeId(event.target.value)}
            className="h-8 w-auto"
            aria-label={format(m.personUserType)}
          >
            <option value="">{format(m.pickerAnyType)}</option>
            {(options.data?.userTypes ?? []).map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </NativeSelect>
          <ToggleGroup
            type="single"
            value={scope}
            onValueChange={(next) => next && setScope(next as 'self' | 'subtree')}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="self">{format(m.pickerScopeSelf)}</ToggleGroupItem>
            <ToggleGroupItem value="subtree">{format(m.pickerScopeSubtree)}</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <AsyncSection
          pending={people.isPending && here !== null}
          error={people.isError ? formatError(people.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void people.refetch()}
          skeleton={
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          }
        >
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.pickerNobody)}</p>
          ) : (
            <ul className="max-h-64 divide-y overflow-auto rounded-md border">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    checked={chosen.has(row.id)}
                    disabled={blocked.has(row.id)}
                    aria-label={row.displayName}
                    onCheckedChange={() => toggle(row.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <PersonCell
                      name={row.displayName}
                      secondary={row.businessNo ?? format(m.personNoBusinessNo)}
                    />
                  </span>
                  {blocked.has(row.id) ? (
                    <Badge variant="secondary">{format(m.pickerAlreadyIn)}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">{row.userType.name}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {format(m.pickerChosen, { count: context.value.length })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={at === 0}
              onClick={() => setAt((page) => Math.max(0, page - 1))}
            >
              {format(m.pickerPrevious)}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={nextCursor === null}
              onClick={() => setAt((page) => page + 1)}
            >
              {format(m.pickerNext)}
            </Button>
          </div>
        </div>

        {context.value.length > 0 && context.single !== true && (
          <div className="flex flex-wrap gap-1.5">
            {rows
              .filter((row) => chosen.has(row.id))
              .map((row) => (
                <Badge key={row.id} variant="secondary" className="gap-1 font-normal">
                  {row.displayName}
                  <button
                    type="button"
                    aria-label={format(m.pickerRemove, { name: row.displayName })}
                    onClick={() => toggle(row.id)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
            {/* whoever was chosen on another page is counted, not named: the
                list only holds what this page fetched */}
            {context.value.length > rows.filter((row) => chosen.has(row.id)).length && (
              <Badge variant="outline" className="font-normal">
                {format(m.pickerChosenElsewhere, {
                  count: context.value.length - rows.filter((row) => chosen.has(row.id)).length,
                })}
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
