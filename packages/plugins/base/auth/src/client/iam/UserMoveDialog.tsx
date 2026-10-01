import { assertNever } from '@qualy/web-i18n'
import { useApiMutation, UiSlot, useApi, useApiQuery } from '@qualy/web-runtime'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { orgNodePicker, type OrgNodePickerContext } from '@qualy/ui-contract'

import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { ConfirmDialog, FormDialog } from '@qualy/ui/admin'
import { CardEmpty } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'

import { authApi } from '../api.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Moving somebody to another unit, from wherever their record is open: the
// organization section and the band above every section open the same
// dialog, so the act is one act wherever it is started.
//
// It is a task with an end, so a dialog over the record rather than a tree
// sitting open on a page; and it is confirmed, because it re-anchors every
// authority that follows the unit. The units this person's kind may not stand
// in are drawn and refused with the reason - the write refuses them anyway,
// and a picker that offers them turns a rule into an error after the press.

const styles = stylex.create({
  // the picker draws its own box; the dialog gives it a height to grow into
  seat: { display: 'flex', minHeight: 0, height: '25rem', flexDirection: 'column' },
  chosen: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  chosenName: { color: tokens.foreground, fontWeight: 500 },
})

export type MoveOutcome =
  | { readonly moved: true }
  | { readonly moved: false; readonly said: string }

export function UserMoveDialog({
  userId,
  open,
  onClose,
  onStart,
  onDone,
}: {
  userId: string
  open: boolean
  onClose: () => void
  /** the move is under way: whatever was said about an earlier one no longer holds */
  onStart: () => void
  onDone: (outcome: MoveOutcome) => void
}) {
  const api = useApi(authApi)

  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()

  const [destination, setDestination] = useState('')
  const [confirming, setConfirming] = useState('')

  // each opening starts from nothing chosen
  useEffect(() => {
    if (open) setDestination('')
  }, [open])

  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const record = user.data?.user
  const rule = user.data?.placement
  const here = record?.primaryOrgNode?.id
  // the same read the picker makes, for the two things it cannot know: which
  // units this reader may place into, and what they are called afterwards
  const options = useQuery({
    ...query.identity.getUserOptions.queryOptions({ query: {} }),
    enabled: open || confirming !== '',
  })

  // Shown and refused rather than absent: each has a different answer - not
  // yours, they are already there, or their kind does not stand in that sort
  // of unit.
  const barred = useMemo(() => {
    const out: Record<string, string> = {}
    for (const node of options.data?.nodes ?? []) {
      const fits =
        rule === undefined ||
        rule.mode === 'unrestricted' ||
        (rule.mode === 'tenant-root'
          ? node.parentId === null
          : rule.orgTypeIds.includes(node.orgTypeId))
      if (!fits) out[node.orgNodeId] = m.users_moveTypeRefused()
      else if (!node.manageable) out[node.orgNodeId] = m.users_moveNotManageable()
    }
    if (here !== undefined) out[here] = m.users_moveAlreadyHere()
    return out
  }, [options.data, rule, here])

  const named = useMemo(
    () => new Map((options.data?.nodes ?? []).map((node) => [node.orgNodeId, node.name])),
    [options.data],
  )

  const move = useApiMutation({
    mutationFn: (primaryOrgNodeId: string) =>
      api.identity.setUserPlacement({
        params: { userId },
        payload: { primaryOrgNodeId, version: record?.version ?? 1 },
      }),
    onMutate: onStart,
    onSuccess: async () => {
      setDestination('')
      onDone({ moved: true })
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
    },
    onError: (error) => {
      let failure: string
      switch (error._tag) {
        case 'SYSTEM_ACCOUNT_PROTECTED':
          failure = m.error_systemAccountProtected()
          break
        case 'USER_PLACEMENT_NOT_FOUND':
          failure = m.error_userPlacementNotFound()
          break
        case 'USER_TYPE_NOT_FOUND':
          failure = m.error_userTypeNotFound()
          break
        case 'USER_TYPE_PLACEMENT_NOT_ALLOWED':
          failure = m.error_userTypePlacementNotAllowed()
          break
        case 'USER_VERSION_CONFLICT':
          failure = m.error_userVersionConflict()
          break
        default:
          assertNever(error)
      }
      onDone({ moved: false, said: failure })
    },
  })

  const picker: OrgNodePickerContext = {
    value: destination === '' ? [] : [destination],
    onChange: (ids) => setDestination(ids[0] ?? ''),
    single: true,
    disabled: barred,
  }
  const target = named.get(confirming) ?? confirming

  return (
    <>
      <FormDialog
        open={open}
        title={m.users_move()}
        description={m.users_movePick()}
        onClose={() => {
          setDestination('')
          onClose()
        }}
        footer={
          <>
            {destination !== '' && (
              <span {...stylex.props(styles.chosen)}>
                {m.users_moveTarget()}{' '}
                <span {...stylex.props(styles.chosenName)}>
                  {named.get(destination) ?? destination}
                </span>
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDestination('')
                onClose()
              }}
            >
              {commonMessages.action_cancel()}
            </Button>
            <Button
              size="sm"
              data-testid="move-choose"
              disabled={destination === '' || destination === here}
              onClick={() => {
                onClose()
                setConfirming(destination)
              }}
            >
              {m.users_moveAction()}
            </Button>
          </>
        }
      >
        <div data-testid="move-picker" {...stylex.props(styles.seat)}>
          <UiSlot
            token={orgNodePicker}
            context={picker}
            fallback={<CardEmpty>{m.users_movePickerUnavailable()}</CardEmpty>}
          />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={confirming !== ''}
        title={m.users_moveConfirm()}
        description={m.users_moveConfirmBody({
          name: record?.displayName ?? '',
          from: record?.primaryOrgNode?.name ?? m.word_none(),
          to: target,
        })}
        confirmLabel={m.users_moveAction()}
        cancelLabel={commonMessages.action_cancel()}
        pending={move.isPending}
        onConfirm={() => {
          const to = confirming
          setConfirming('')
          move.mutate(to)
        }}
        onCancel={() => setConfirming('')}
      />
    </>
  )
}
