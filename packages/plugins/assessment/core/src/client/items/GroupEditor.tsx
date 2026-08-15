import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { Choice } from './Choice.tsx'
import type { TreeGroup } from './paper.ts'

// One section of the paper: its name and its two limits.
//
// Three fields and a reason is a panel's worth of screen, not a page's - the
// structure it belongs to stays visible behind it, which is the thing the
// author is actually reasoning about while they set a limit.
//
// Saving sends the whole tree because that is what the api takes - and every
// row keeps the id it came with, which is what tells the server this is the
// same group rather than a new one replacing it.

export function GroupEditor({
  open,
  batchId,
  batchStatus,
  groups,
  version,
  editing,
  parentId,
  onClose,
  onDone,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  batchId: string
  batchStatus: string
  groups: readonly TreeGroup[]
  /** the tree these groups were read at; a save states it and can be refused */
  version: number
  /** null while a group is being composed and has never been saved */
  editing: TreeGroup | null
  /** where a new group goes; ignored when editing */
  parentId: string | null
  onClose: () => void
  onDone: (groupId: string | null) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [name, setName] = useState(editing?.name ?? '')
  const [cap, setCap] = useState(editing?.cap ?? '')
  const [floor, setFloor] = useState(editing?.floor ?? '')
  const [parent, setParent] = useState(editing?.parentGroupId ?? parentId ?? '')
  const [reason, setReason] = useState('')
  const [refusals, setRefusals] = useState<readonly { reason: string; groupId: string | null }[]>(
    [],
  )

  /**
   * Where this section may sit.
   *
   * Anywhere but inside itself: a section cannot be its own ancestor, and
   * offering the move only to have the round refuse it teaches nothing. The
   * paper is not offered a parent at all - the outermost section is the one
   * thing there can only be one of.
   */
  const inside = new Set<string>()
  if (editing !== null) {
    inside.add(editing.id)
    for (let found = true; found;) {
      found = false
      for (const group of groups) {
        if (
          group.parentGroupId !== null &&
          inside.has(group.parentGroupId) &&
          !inside.has(group.id)
        ) {
          inside.add(group.id)
          found = true
        }
      }
    }
  }
  const destinations = groups.filter((group) => !inside.has(group.id))
  const movable = editing === null || editing.parentGroupId !== null

  const specOf = (group: TreeGroup) => ({
    id: group.id,
    parentGroupId: group.parentGroupId,
    name: group.name,
    cap: group.cap,
    floor: group.floor,
  })

  const onError = (error: unknown) => {
    const invalid = error as { refusals?: readonly { reason: string; groupId: string | null }[] }
    if (Array.isArray(invalid.refusals)) setRefusals(invalid.refusals)
    else toast.error(formatError(error))
  }

  const save = useMutation({
    mutationFn: () => {
      const values = {
        name: name.trim(),
        cap: cap.trim() === '' ? null : cap.trim(),
        floor: floor.trim() === '' ? null : floor.trim(),
        // the paper keeps the one thing that makes it the paper
        ...(movable ? { parentGroupId: parent === '' ? null : parent } : {}),
      }
      const edited = groups.map((group) =>
        group.id === editing?.id ? { ...specOf(group), ...values } : specOf(group),
      )
      // one being composed joins the tree the same way every other row is
      // written: as part of the whole set the api replaces
      const created =
        editing === null ? [{ parentGroupId: parent === '' ? null : parent, ...values }] : []
      return run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: [...edited, ...created],
            expectedVersion: version,
            ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
          },
        }),
      )
    },
    onMutate: () => setRefusals([]),
    onSuccess: (result: { groups: readonly { id: string; name: string }[] }) => {
      toast.success(format(m.itemsGroupsSaved))
      const known = new Set(groups.map((group) => group.id))
      const landed = editing?.id ?? result.groups.find((group) => !known.has(group.id))?.id ?? null
      onDone(landed)
    },
    onError,
  })

  const remove = useMutation({
    mutationFn: () =>
      run(
        api.assessment.replaceScoreGroups({
          params: { batchId },
          payload: {
            groups: groups.filter((group) => group.id !== editing?.id).map(specOf),
            expectedVersion: version,
            ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
          },
        }),
      ),
    onMutate: () => setRefusals([]),
    onSuccess: () => {
      toast.success(format(m.itemsGroupsSaved))
      onDone(null)
    },
    onError,
  })

  return (
    <SidePanel
      open={open}
      title={format(editing === null ? m.itemsGroupNew : m.itemsGroupEditing)}
      onClose={onClose}
      footer={
        <>
          {editing !== null && (
            <>
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {format(m.itemsGroupRemove)}
              </Button>
              <span className="flex-1" />
            </>
          )}
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={save.isPending || name.trim() === ''} onClick={() => save.mutate()}>
            {format(m.entrySave)}
          </Button>
        </>
      }
    >
      <Field label={format(m.itemsGroupName)}>
        {(id) => (
          <Input id={id} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        )}
      </Field>
      {movable && (
        <Field label={format(m.itemsGroupParent)} hint={format(m.itemsGroupParentHint)}>
          {(id) => (
            <Choice
              id={id}
              value={parent}
              options={destinations.map((group) => ({
                value: group.id,
                label: group.name.trim() === '' ? format(m.itemsGroupUnnamed) : group.name,
              }))}
              onChange={setParent}
            />
          )}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={format(m.itemsGroupCap)} hint={format(m.itemsGroupCapHint)}>
          {(id) => <Input id={id} value={cap} onChange={(event) => setCap(event.target.value)} />}
        </Field>
        <Field label={format(m.itemsGroupFloor)} hint={format(m.itemsGroupFloorHint)}>
          {(id) => (
            <Input id={id} value={floor} onChange={(event) => setFloor(event.target.value)} />
          )}
        </Field>
      </div>
      {batchStatus === 'active' && (
        <Field label={format(m.itemsFieldReason)} hint={format(m.itemsGroupsReasonHint)}>
          {(id) => (
            <Input id={id} value={reason} onChange={(event) => setReason(event.target.value)} />
          )}
        </Field>
      )}
      {refusals.length > 0 && (
        <ul className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {refusals.map((refusal, index) => (
            <li key={index}>
              {groups.find((group) => group.id === refusal.groupId)?.name ?? ''}{' '}
              {format(GROUP_REFUSALS[refusal.reason] ?? m.itemsGroupRefusedOther)}
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  )
}

const GROUP_REFUSALS: Record<string, MessageDescriptor> = {
  'group-not-found': m.itemsGroupRefusedNotFound,
  'group-has-items': m.itemsGroupRefusedHasItems,
  'group-has-children': m.itemsGroupRefusedHasChildren,
  'floor-above-cap': m.itemsGroupRefusedFloorAboveCap,
  'reason-required': m.itemsGroupRefusedReason,
  'parent-not-in-batch': m.itemsGroupRefusedParent,
  'parent-is-self': m.itemsGroupRefusedParent,
  'parent-cycle': m.itemsGroupRefusedParent,
  'one-paper-only': m.itemsGroupRefusedOnePaper,
}
