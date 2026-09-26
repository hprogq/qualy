import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
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
//
// The people are asked for by page number, as the roster of users asks for
// them: somebody choosing among a few hundred goes to page four and back,
// and wants to know how many pages there are before they start.

const PAGE = 20

export default function PeoplePicker({ context }: { context: PeoplePickerContext }) {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()

  const [nodeId, setNodeId] = useState<string | null>(null)
  const [scope, setScope] = useState<'self' | 'subtree'>('subtree')
  const [userTypeId, setUserTypeId] = useState('')
  const [search, setSearch] = useState('')
  // the page carries the question it belongs to, so a filter change starts
  // the new question at its first page
  const [paging, setPaging] = useState({ question: '', page: 1 })

  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  const nodes = options.data?.nodes ?? []
  const here = nodeId ?? nodes[0]?.orgNodeId ?? null

  const question = `${here ?? ''}:${scope}:${search}:${userTypeId}`
  const page = paging.question === question ? paging.page : 1

  const people = useQuery({
    ...query.identity.listUsers.queryOptions({
      query: {
        orgNodeId: here ?? '',
        scope,
        ...(search !== '' ? { search } : {}),
        ...(userTypeId !== '' ? { userTypeId } : {}),
        page: String(page),
        limit: String(PAGE),
      },
    }),
    enabled: here !== null,
    // the page being left stays up until the next one arrives, so turning a
    // page does not blank the table under the pointer
    placeholderData: keepPreviousData,
  })

  const total = people.data?.total ?? 0
  const current = people.data?.page ?? page
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const goTo = (next: number) => setPaging({ question, page: Math.min(Math.max(1, next), pages) })

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
          unitId: row.primaryOrgNode.id,
          unitName: row.primaryOrgNode.name,
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
        hasPrevious: current > 1,
        hasNext: current < pages,
        paging: { page: current, pageSize: PAGE, total, onPage: goTo },
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
        onChange: (userIds) => context.onChange(userIds.filter((id) => !blocked.has(id))),
        onPrevious: () => goTo(current - 1),
        onNext: () => goTo(current + 1),
        onRetry: () => void people.refetch(),
      }}
    />
  )
}
