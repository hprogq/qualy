import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { UiSlot, useApiQuery } from '@qualy/web-runtime'
import { peoplePickerView } from '@qualy/ui-contract'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'

// Adding people to the roster one at a time, or a dozen at a time.
//
// The drawing is the directory's - tree, search, kind, pages - but the
// people in it come from this round's own endpoint: the people this reader
// manages, which is exactly who the write admits. A round's administrator
// need not hold the directory's read permission, and before this the dialog
// told them they could see nobody. Nothing chosen here is authorized by
// having been chosen; the write proves every id again.

const PAGE = 20

const styles = stylex.create({
  body: { height: '58vh' },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
})

export function AddPeopleDialog({
  batchId,
  open,
  pending,
  onAdd,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  onAdd: (userIds: readonly string[]) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [nodeId, setNodeId] = useState<string | null>(null)
  const [scope, setScope] = useState<'self' | 'subtree'>('subtree')
  const [userTypeId, setUserTypeId] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => {
    if (!open) return
    setChosen([])
    setNodeId(null)
    setScope('subtree')
    setUserTypeId('')
    setSearch('')
    setPage(1)
  }, [open])

  const units = useQuery({ ...query.assessment.listScopeOptions.queryOptions({}), enabled: open })
  const kinds = useQuery({
    ...query.assessment.listUserTypeOptions.queryOptions({}),
    enabled: open,
  })
  const people = useQuery({
    ...query.assessment.listParticipantCandidates.queryOptions({
      params: { batchId },
      query: {
        page: String(page),
        limit: String(PAGE),
        ...(nodeId !== null ? { orgNodeId: nodeId, orgScope: scope } : {}),
        ...(userTypeId !== '' ? { userTypeId } : {}),
        ...(search !== '' ? { q: search } : {}),
      },
    }),
    enabled: open,
    placeholderData: keepPreviousData,
  })
  const rows = people.data?.items ?? []
  const pages = Math.max(1, Math.ceil((people.data?.total ?? 0) / PAGE))
  const at = people.data?.page ?? page
  // a different question starts at its first page
  const asking =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value)
      setPage(1)
    }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="56rem">
        <DialogHeader>
          <DialogTitle>{format(m.addPeopleTitle)}</DialogTitle>
          <DialogDescription>{format(m.addPeopleHint, { businessNo })}</DialogDescription>
        </DialogHeader>
        <DialogBody xstyle={styles.body}>
          {/* a column, so the picker can be told to fill what is left */}
          <UiSlot
            token={peoplePickerView}
            context={{
              nodes: (units.data?.nodes ?? []).map((node) => ({
                id: node.id,
                name: node.name,
                parentId: node.parentId,
              })),
              userTypes: (kinds.data?.userTypes ?? []).map((kind) => ({
                id: kind.id,
                name: kind.name,
              })),
              rows: rows.map((row) => ({
                id: row.userId,
                displayName: row.displayName,
                businessNo: row.businessNo,
                userTypeName: row.userTypeName,
              })),
              nodeId,
              scope,
              userTypeId,
              search,
              value: chosen,
              // somebody taking part already is shown, and cannot be added
              // twice; somebody taken off the roster can be let back in
              disabled: rows.filter((row) => row.roster === 'active').map((row) => row.userId),
              disabledLabel: format(m.addPeopleOnRoster),
              pending: people.isPending || units.isPending,
              error: people.isError ? formatError(people.error) : null,
              hasPrevious: at > 1,
              hasNext: at < pages,
              onNodeChange: asking((next: string) => setNodeId(next)),
              onScopeChange: asking(setScope),
              onUserTypeChange: asking(setUserTypeId),
              onSearchChange: asking(setSearch),
              onToggle: (userId: string) => {
                const row = rows.find((one) => one.userId === userId)
                if (row?.roster === 'active') return
                setChosen((now) =>
                  now.includes(userId) ? now.filter((id) => id !== userId) : [...now, userId],
                )
              },
              onPrevious: () => setPage(Math.max(1, at - 1)),
              onNext: () => setPage(Math.min(pages, at + 1)),
              onRetry: () => void people.refetch(),
            }}
            fallback={<p {...stylex.props(styles.quiet)}>{format(m.pickerUnavailable)}</p>}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={pending || chosen.length === 0} onClick={() => onAdd(chosen)}>
            {format(m.addPeopleConfirm, { count: chosen.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
