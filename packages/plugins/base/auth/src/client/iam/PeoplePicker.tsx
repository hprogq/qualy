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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
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

// a select cannot hold the empty string as a value, so "any" needs a word
const ANY = 'any'

export default function PeoplePicker({ context }: { context: PeoplePickerContext }) {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()

  const [node, setNode] = useState<{ id: string; name: string } | null>(null)
  const [scope, setScope] = useState<'self' | 'subtree'>('subtree')
  const [userTypeId, setUserTypeId] = useState('')
  const [search, setSearch] = useState('')
  const [settled, setSettled] = useState('')
  // the cursor stack carries the question it belongs to, so a filter change
  // cannot send the previous question's cursor: the server refuses one that
  // did not come from the question being asked, and rightly
  const [paging, setPaging] = useState<{
    question: string
    cursors: readonly (string | undefined)[]
    at: number
  }>({ question: '', cursors: [undefined], at: 0 })

  useEffect(() => {
    const timer = setTimeout(() => setSettled(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  const nodes = options.data?.nodes ?? []
  const here = node ?? (nodes[0] ? { id: nodes[0].orgNodeId, name: nodes[0].name } : null)

  const question = `${here?.id ?? ''}:${scope}:${settled}:${userTypeId}`
  const page = paging.question === question ? paging : { question, cursors: [undefined], at: 0 }
  const { cursors, at } = page

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
    setPaging({ question, cursors: [...cursors.slice(0, at + 1), nextCursor], at })
  }, [nextCursor, at, cursors, question])

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
    <div className="grid min-h-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="flex min-h-0 min-w-0 flex-col gap-2">
        <p className="text-sm font-medium">{format(m.pickerUnits)}</p>
        <div className="min-h-56 flex-1 overflow-auto rounded-md border p-1">
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

      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={format(m.pickerSearch)}
            className="h-8 min-w-40 flex-1"
          />
          <Select
            value={userTypeId === '' ? ANY : userTypeId}
            onValueChange={(next) => setUserTypeId(next === ANY ? '' : next)}
          >
            <SelectTrigger size="sm" className="w-auto" aria-label={format(m.personUserType)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{format(m.pickerAnyType)}</SelectItem>
              {(options.data?.userTypes ?? []).map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            spacing={0}
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
          className="flex min-h-0 flex-1 flex-col"
          pending={people.isPending && here !== null}
          error={people.isError ? formatError(people.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void people.refetch()}
          skeleton={<Skeleton className="min-h-40 w-full flex-1" />}
        >
          {rows.length === 0 ? (
            <p className="flex min-h-40 flex-1 items-center justify-center rounded-md border text-sm text-muted-foreground">
              {format(m.pickerNobody)}
            </p>
          ) : (
            <ul className="min-h-40 flex-1 divide-y overflow-auto rounded-md border">
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
              onClick={() => setPaging({ question, cursors, at: Math.max(0, at - 1) })}
            >
              {format(m.pickerPrevious)}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={nextCursor === null}
              onClick={() => setPaging({ question, cursors, at: at + 1 })}
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
