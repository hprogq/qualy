import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PeoplePickerViewContext } from '@qualy/ui-contract'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { assessmentApi } from '../api.ts'

// The people a round's administrator may bring into it, paged for the
// people picker's drawing: onto the roster, or onto the staff.
//
// Both come from this domain rather than the directory. Who a round's
// administrator manages is who they may add, and they need not hold the
// directory's own read permission - a dialog that asked for it told them
// they could see nobody. The units to look in and the kinds of people are
// the ones the batch form offers. Nothing chosen here is authorized by
// having been chosen; every write proves each id again.

const PAGE = 20

export function useCandidates(batchId: string, open: boolean) {
  const query = useApiQuery(assessmentApi)
  const { formatError } = useI18n()
  const [nodeId, setNodeId] = useState<string | null>(null)
  const [scope, setScope] = useState<'self' | 'subtree'>('subtree')
  const [userTypeId, setUserTypeId] = useState('')
  const [search, setSearch] = useState('')
  const [at, setAt] = useState(1)
  // every opening starts from the top of the organization and page one
  useEffect(() => {
    if (!open) return
    setNodeId(null)
    setScope('subtree')
    setUserTypeId('')
    setSearch('')
    setAt(1)
  }, [open])

  const units = useQuery({ ...query.assessment.listScopeOptions.queryOptions({}), enabled: open })
  const kinds = useQuery({
    ...query.assessment.listUserTypeOptions.queryOptions({}),
    enabled: open,
  })
  const page = useQuery({
    ...query.assessment.listParticipantCandidates.queryOptions({
      params: { batchId },
      query: {
        page: String(at),
        limit: String(PAGE),
        ...(nodeId !== null ? { orgNodeId: nodeId, orgScope: scope } : {}),
        ...(userTypeId !== '' ? { userTypeId } : {}),
        ...(search !== '' ? { q: search } : {}),
      },
    }),
    enabled: open,
    placeholderData: keepPreviousData,
  })
  const rows = page.data?.items ?? []
  const pages = Math.max(1, Math.ceil((page.data?.total ?? 0) / PAGE))
  const current = page.data?.page ?? at
  // a different question starts at its first page
  const asking =
    <T>(set: (value: T) => void) =>
    (value: T) => {
      set(value)
      setAt(1)
    }

  /** the picker's context over this page, with the caller's own choice in it */
  const context = (choice: {
    value: readonly string[]
    onToggle: (userId: string) => void
    /** the whole choice at once: a page taken in, everybody let go */
    onChange: (userIds: readonly string[]) => void
    disabled?: readonly string[]
    disabledLabel?: string
  }): PeoplePickerViewContext => ({
    nodes: (units.data?.nodes ?? []).map((node) => ({
      id: node.id,
      name: node.name,
      parentId: node.parentId,
    })),
    userTypes: (kinds.data?.userTypes ?? []).map((kind) => ({ id: kind.id, name: kind.name })),
    rows: rows.map((row) => ({
      id: row.userId,
      displayName: row.displayName,
      businessNo: row.businessNo,
      userTypeName: row.userTypeName,
      // spelled from the units above, which are the ones the reader manages
      unitId: row.orgNodeId,
    })),
    nodeId,
    scope,
    userTypeId,
    search,
    value: choice.value,
    ...(choice.disabled === undefined ? {} : { disabled: choice.disabled }),
    ...(choice.disabledLabel === undefined ? {} : { disabledLabel: choice.disabledLabel }),
    pending: page.isPending || units.isPending,
    error: page.isError ? formatError(page.error) : null,
    hasPrevious: current > 1,
    hasNext: current < pages,
    paging: {
      page: current,
      pageSize: PAGE,
      total: page.data?.total ?? 0,
      onPage: (next: number) => setAt(Math.min(pages, Math.max(1, next))),
    },
    onNodeChange: asking((next: string) => setNodeId(next)),
    onScopeChange: asking(setScope),
    onUserTypeChange: asking(setUserTypeId),
    onSearchChange: asking(setSearch),
    onToggle: choice.onToggle,
    onChange: choice.onChange,
    onPrevious: () => setAt(Math.max(1, current - 1)),
    onNext: () => setAt(Math.min(pages, current + 1)),
    onRetry: () => void page.refetch(),
  })

  return { page, rows, context }
}
