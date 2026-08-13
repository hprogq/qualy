import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// The score tree: groups inside groups, each with its own ceiling. A cap on
// sport inside a cap on activities is how a real regulation reads, and the
// two only mean different things because the inner one is applied first.
//
// Rows keep the id they came with. A row saved without one is a new group,
// and a group whose id stops being sent is deleted - so dropping the id
// while editing a cap would ask the server to delete a group that has
// questions under it and refuse the whole save. That was the bug this
// editor is built around.

export interface GroupRow {
  /** absent on a row that has never been saved */
  id?: string
  parentGroupId: string | null
  name: string
  cap: string
  floor: string
  itemCount: number
  /** stable while the row is on screen, so React and the tree agree */
  key: string
}

export interface GroupSource {
  id: string
  parentGroupId: string | null
  name: string
  cap: string | null
  floor: string | null
  sortOrder: number
  itemCount: number
}

let minted = 0
const nextKey = () => `new-${(minted += 1)}`

export function GroupTreeEditor({
  batchId,
  batchStatus,
  groups,
  onSaved,
}: {
  batchId: string
  batchStatus: string
  groups: readonly GroupSource[]
  onSaved: () => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [rows, setRows] = useState<GroupRow[]>([])
  const [reason, setReason] = useState('')
  const [refusals, setRefusals] = useState<readonly { reason: string; groupId: string | null }[]>(
    [],
  )

  useEffect(() => {
    setRows(
      [...groups]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((group) => ({
          id: group.id,
          parentGroupId: group.parentGroupId,
          name: group.name,
          cap: group.cap ?? '',
          floor: group.floor ?? '',
          itemCount: group.itemCount,
          key: group.id,
        })),
    )
  }, [groups])

  // the tree as the screen draws it: parents before their children, each
  // depth known so a row can be indented without walking anything
  const ordered = useMemo(() => {
    const childrenOf = new Map<string | null, GroupRow[]>()
    for (const row of rows) {
      const key = row.parentGroupId
      const bucket = childrenOf.get(key)
      if (bucket === undefined) childrenOf.set(key, [row])
      else bucket.push(row)
    }
    const out: { row: GroupRow; depth: number }[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const row of childrenOf.get(parent) ?? []) {
        out.push({ row, depth })
        if (row.id !== undefined) walk(row.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [rows])

  const patch = (key: string, next: Partial<GroupRow>) =>
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...next } : row)))

  const save = useMutation({
    mutationFn: () =>
      run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: ordered.map(({ row }) => ({
              // the id is what tells the server this is the same group
              ...(row.id !== undefined ? { id: row.id } : {}),
              parentGroupId: row.parentGroupId,
              name: row.name.trim(),
              cap: row.cap.trim() === '' ? null : row.cap.trim(),
              floor: row.floor.trim() === '' ? null : row.floor.trim(),
            })),
            ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
          },
        }),
      ),
    onMutate: () => setRefusals([]),
    onSuccess: () => {
      toast.success(format(m.itemsGroupsSaved))
      setReason('')
      onSaved()
    },
    onError: (error: unknown) => {
      const invalid = error as { refusals?: readonly { reason: string; groupId: string | null }[] }
      if (Array.isArray(invalid.refusals)) setRefusals(invalid.refusals)
      else toast.error(formatError(error))
    },
  })

  const add = (parentGroupId: string | null) =>
    setRows((previous) => [
      ...previous,
      {
        parentGroupId,
        name: '',
        cap: '',
        floor: '',
        itemCount: 0,
        key: nextKey(),
      },
    ])

  const remove = (key: string) =>
    setRows((previous) => {
      const row = previous.find((candidate) => candidate.key === key)
      if (row === undefined) return previous
      // a group's children come with it rather than being orphaned into the
      // top level behind the reader's back
      const doomed = new Set<string>([key])
      let grew = true
      while (grew) {
        grew = false
        for (const candidate of previous) {
          const parent = previous.find((other) => other.id === candidate.parentGroupId)
          if (parent !== undefined && doomed.has(parent.key) && !doomed.has(candidate.key)) {
            doomed.add(candidate.key)
            grew = true
          }
        }
      }
      return previous.filter((candidate) => !doomed.has(candidate.key))
    })

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <h3 className="text-sm font-medium">{format(m.itemsGroupsTitle)}</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => add(null)}>
            {format(m.itemsGroupAdd)}
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {format(m.itemsGroupsSave)}
          </Button>
        </div>
      </div>
      <p className="pb-3 text-xs text-muted-foreground">{format(m.itemsGroupsHint)}</p>

      <div className="flex flex-col gap-2">
        {ordered.length === 0 && (
          <p className="text-sm text-muted-foreground">{format(m.itemsGroupsEmpty)}</p>
        )}
        {ordered.map(({ row, depth }) => (
          <div
            key={row.key}
            className="flex flex-wrap items-end gap-2 rounded-md border p-2"
            style={{ marginLeft: `${depth * 1.5}rem` }}
          >
            <div className="min-w-40 flex-1">
              <Field label={format(m.itemsGroupName)}>
                {(id) => (
                  <Input
                    id={id}
                    value={row.name}
                    onChange={(event) => patch(row.key, { name: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="w-24">
              <Field label={format(m.itemsGroupCap)}>
                {(id) => (
                  <Input
                    id={id}
                    value={row.cap}
                    onChange={(event) => patch(row.key, { cap: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="w-24">
              <Field label={format(m.itemsGroupFloor)}>
                {(id) => (
                  <Input
                    id={id}
                    value={row.floor}
                    onChange={(event) => patch(row.key, { floor: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="flex items-center gap-1 pb-1">
              {row.id !== undefined && (
                <Button variant="ghost" size="sm" onClick={() => add(row.id!)}>
                  {format(m.itemsGroupAddChild)}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => remove(row.key)}>
                {format(m.itemsGroupRemove)}
              </Button>
              {row.itemCount > 0 && (
                <span className="pl-1 text-xs text-muted-foreground">
                  {format(m.itemsGroupItemCount, { count: row.itemCount })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {batchStatus === 'active' && (
        <div className="pt-3">
          <Field label={format(m.itemsFieldReason)} hint={format(m.itemsGroupsReasonHint)}>
            {(id) => (
              <Input id={id} value={reason} onChange={(event) => setReason(event.target.value)} />
            )}
          </Field>
        </div>
      )}

      {refusals.length > 0 && (
        <ul className="mt-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {refusals.map((refusal, index) => (
            <li key={index}>
              {rows.find((row) => row.id === refusal.groupId)?.name ?? ''}{' '}
              {format(GROUP_REFUSALS[refusal.reason] ?? m.itemsGroupRefusedOther)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const GROUP_REFUSALS: Record<string, MessageDescriptor> = {
  'group-has-items': m.itemsGroupRefusedHasItems,
  'group-has-children': m.itemsGroupRefusedHasChildren,
  'floor-above-cap': m.itemsGroupRefusedFloorAboveCap,
  'reason-required': m.itemsGroupRefusedReason,
  'parent-not-in-batch': m.itemsGroupRefusedParent,
  'parent-is-self': m.itemsGroupRefusedParent,
  'parent-cycle': m.itemsGroupRefusedParent,
  'group-not-found': m.itemsGroupRefusedOther,
}
