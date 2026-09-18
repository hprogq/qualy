import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PeoplePickerContext } from '@qualy/ui-contract'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { authApi } from '../api.ts'
import { authMessages as m } from '../i18n.ts'
import PeoplePickerView from './PeoplePickerView.tsx'

// Choosing people out of the directory.
//
// The drawing is `PeoplePickerView`; this is the half that knows where the
// people come from - which is the half that carries the authority. Everything
// it can show is what the server will show it: the tree is the caller's own
// reach and the list is filtered by the same authority, so the screen has no
// idea a wider organization exists.
//
// Split in two because a round's roster is a different population with a
// different authorization, and it needs this drawing without this directory.
// The view is a slot of its own for that reason; this one stays behind
// `auth.user.read`, because reading the directory is exactly what it does.

const PAGE = 25

export default function PeoplePicker({ context }: { context: PeoplePickerContext }) {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()

  const [nodeId, setNodeId] = useState<string | null>(null)
  const [scope, setScope] = useState<'self' | 'subtree'>('subtree')
  const [userTypeId, setUserTypeId] = useState('')
  const [search, setSearch] = useState('')
  // the cursor stack carries the question it belongs to, so a filter change
  // cannot send the previous question's cursor: the server refuses one that
  // did not come from the question being asked, and rightly
  const [paging, setPaging] = useState<{
    question: string
    cursors: readonly (string | undefined)[]
    at: number
  }>({ question: '', cursors: [undefined], at: 0 })

  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  const nodes = options.data?.nodes ?? []
  const here = nodeId ?? nodes[0]?.orgNodeId ?? null

  const question = `${here ?? ''}:${scope}:${search}:${userTypeId}`
  const page = paging.question === question ? paging : { question, cursors: [undefined], at: 0 }
  const { cursors, at } = page

  const people = useQuery({
    ...query.identity.listUsers.queryOptions({
      query: {
        orgNodeId: here ?? '',
        scope,
        ...(search !== '' ? { search } : {}),
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

  return (
    <PeoplePickerView
      context={{
        nodes: nodes.map((row) => ({ id: row.orgNodeId, name: row.name, parentId: row.parentId })),
        nodesTruncated: options.data?.truncated === true,
        userTypes: options.data?.userTypes ?? [],
        rows: (people.data?.items ?? []).map((row) => ({
          id: row.id,
          displayName: row.displayName,
          businessNo: row.businessNo ?? null,
          userTypeName: row.userType?.name ?? null,
        })),
        nodeId: here,
        scope,
        userTypeId,
        search,
        value: context.value,
        ...(context.single === undefined ? {} : { single: context.single }),
        ...(context.disabled === undefined
          ? {}
          : { disabled: context.disabled, disabledLabel: format(m.pickerAlreadyIn) }),
        pending: people.isPending && here !== null,
        error: people.isError ? formatError(people.error) : null,
        hasPrevious: at > 0,
        hasNext: nextCursor !== null,
        onNodeChange: setNodeId,
        onScopeChange: setScope,
        onUserTypeChange: setUserTypeId,
        onSearchChange: setSearch,
        onToggle: (userId) => {
          if (blocked.has(userId)) return
          if (context.single === true) {
            context.onChange(chosen.has(userId) ? [] : [userId])
            return
          }
          const next = new Set(chosen)
          if (next.has(userId)) next.delete(userId)
          else next.add(userId)
          context.onChange([...next])
        },
        onPrevious: () => setPaging({ question, cursors, at: Math.max(0, at - 1) }),
        onNext: () => setPaging({ question, cursors, at: at + 1 }),
        onRetry: () => void people.refetch(),
      }}
    />
  )
}
