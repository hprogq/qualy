import { useApiMutation, useApi } from '@qualy/web-runtime'
import { assertNever, type UseCaseApiFailure } from '@qualy/web-i18n'
import type { Effect } from 'effect'
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ConfirmDialog, Field, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { type Message } from '@qualy/i18n-contract'
import { assessmentApi } from '../api.ts'

import { Choice } from './Choice.tsx'
import { trimAmount } from '../entry/model.ts'
import { type TreeGroup } from './paper.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One section of the paper: its name and its two limits.
//
// Three fields and a reason is a panel's worth of screen, not a page's - the
// structure it belongs to stays visible behind it, which is the thing the
// author is actually reasoning about while they set a limit.
//
// Saving sends the whole tree because that is what the api takes - and every
// row keeps the id it came with, which is what tells the server this is the
// same group rather than a new one replacing it.

const styles = stylex.create({
  removeAction: {
    color: tokens.danger,
  },
  footerGap: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  limitGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
  },
  refusals: {
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.danger} 40%, transparent)`,
    padding: 12,
    fontSize: 14,
    color: tokens.danger,
  },
})

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

  // a group holds questions; taking it away is not a keystroke
  const [removing, setRemoving] = useState(false)
  const [name, setName] = useState(editing?.name ?? '')
  // the stored form carries four places; the box shows what was meant
  const [cap, setCap] = useState(editing?.cap === null ? '' : trimAmount(editing?.cap ?? ''))
  const [floor, setFloor] = useState(
    editing?.floor === null ? '' : trimAmount(editing?.floor ?? ''),
  )
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

  const onError = (
    error: UseCaseApiFailure<Effect.Error<ReturnType<typeof api.assessment.replaceScoreGroups>>>,
  ) => {
    switch (error._tag) {
      case 'ASSESSMENT_BATCH_NOT_FOUND':
        toast.error(m.error_batchNotFound())
        return
      case 'ASSESSMENT_BATCH_READ_ONLY':
        toast.error(m.error_batchReadOnly())
        return
      case 'ASSESSMENT_SCORE_GROUP_VERSION_CONFLICT':
        toast.error(m.error_scoreGroupVersionConflict())
        return
      case 'ASSESSMENT_SCORE_GROUP_INVALID':
        setRefusals(error.refusals)
        if (error.refusals.length === 0) toast.error(m.error_scoreGroupInvalid())
        return
      default:
        assertNever(error)
    }
  }

  const save = useApiMutation({
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
      return api.assessment.replaceScoreGroups({
        params: { batchId },
        payload: {
          groups: [...edited, ...created],
          expectedVersion: version,
          ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        },
      })
    },
    onMutate: () => setRefusals([]),
    onSuccess: (result: { groups: readonly { id: string; name: string }[] }) => {
      toast.success(m.items_groupsSaved())
      const known = new Set(groups.map((group) => group.id))
      const landed = editing?.id ?? result.groups.find((group) => !known.has(group.id))?.id ?? null
      onDone(landed)
    },
    onError,
  })

  const remove = useApiMutation({
    mutationFn: () =>
      api.assessment.replaceScoreGroups({
        params: { batchId },
        payload: {
          groups: groups.filter((group) => group.id !== editing?.id).map(specOf),
          expectedVersion: version,
          ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        },
      }),
    onMutate: () => setRefusals([]),
    onSuccess: () => {
      toast.success(m.items_groupsSaved())
      onDone(null)
    },
    onError,
  })

  return (
    <SidePanel
      open={open}
      title={(editing === null ? m.items_groupNew : m.items_groupEditing)()}
      onClose={onClose}
      footer={
        <>
          {editing !== null && (
            <>
              <Button
                variant="ghost"
                className={stylex.props(styles.removeAction).className}
                disabled={remove.isPending}
                onClick={() => setRemoving(true)}
              >
                {m.items_groupRemove()}
              </Button>
              <span {...stylex.props(styles.footerGap)} />
            </>
          )}
          <Button variant="outline" onClick={onClose}>
            {commonMessages.action_cancel()}
          </Button>
          <Button disabled={save.isPending || name.trim() === ''} onClick={() => save.mutate()}>
            {m.entry_save()}
          </Button>
        </>
      }
    >
      <Field label={m.items_groupName()} required>
        {(id, control) => (
          <Input
            id={id}
            {...control}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      {movable && (
        <Field label={m.items_groupParent()} hint={m.items_groupParentHint()}>
          {(id) => (
            <Choice
              id={id}
              value={parent}
              options={destinations.map((group) => ({
                value: group.id,
                label: group.name.trim() === '' ? m.items_groupUnnamed() : group.name,
              }))}
              onChange={setParent}
            />
          )}
        </Field>
      )}
      <div {...stylex.props(styles.limitGrid)}>
        <Field label={m.items_groupCap()} hint={m.items_groupCapHint()}>
          {(id) => <Input id={id} value={cap} onChange={(event) => setCap(event.target.value)} />}
        </Field>
        <Field label={m.items_groupFloor()} hint={m.items_groupFloorHint()}>
          {(id) => (
            <Input id={id} value={floor} onChange={(event) => setFloor(event.target.value)} />
          )}
        </Field>
      </div>
      {batchStatus === 'active' && (
        <Field label={m.items_fieldReason()} hint={m.items_groupsReasonHint()}>
          {(id) => (
            <Input id={id} value={reason} onChange={(event) => setReason(event.target.value)} />
          )}
        </Field>
      )}
      {refusals.length > 0 && (
        <ul {...stylex.props(styles.refusals)}>
          {refusals.map((refusal, index) => (
            <li key={index}>
              {groups.find((group) => group.id === refusal.groupId)?.name ?? ''}{' '}
              {(GROUP_REFUSALS[refusal.reason] ?? m.items_groupRefusedOther)()}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing}
        tone="destructive"
        title={m.items_groupRemoveTitle()}
        description={m.items_groupRemoveHint()}
        confirmLabel={m.items_groupRemove()}
        cancelLabel={commonMessages.action_cancel()}
        pending={remove.isPending}
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false)
          remove.mutate()
        }}
      />
    </SidePanel>
  )
}

const GROUP_REFUSALS: Record<string, Message> = {
  'group-not-found': m.items_groupRefusedNotFound,
  'group-has-items': m.items_groupRefusedHasItems,
  'group-has-children': m.items_groupRefusedHasChildren,
  'floor-above-cap': m.items_groupRefusedFloorAboveCap,
  'reason-required': m.items_groupRefusedReason,
  'parent-not-in-batch': m.items_groupRefusedParent,
  'parent-is-self': m.items_groupRefusedParent,
  'parent-cycle': m.items_groupRefusedParent,
  'one-paper-only': m.items_groupRefusedOnePaper,
}
