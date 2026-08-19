import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@qualy/ui/empty'
import { PersonCell } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@qualy/ui/table'
import { personCard } from '@qualy/ui-contract'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { AccessAdjustDialog } from './AccessAdjustDialog.tsx'
import { AccessSyncDialog } from './AccessSyncDialog.tsx'
import { AddStaffDialog } from './AddStaffDialog.tsx'
import { AccessSyncNotice } from './AccessSyncNotice.tsx'
import { inCatalogOrder, permissionLabel } from './permissions.ts'
import type { AccessSelection, AccessSource, AccessSubject } from './model.ts'

// Who may work on this round, and on whose authority.
//
// Not a list of roles: a role is the organization's word for what somebody
// generally does, and this page is about what this round accepted of it. The
// two can differ, and the difference is the whole point - so the table says
// what holds today, and everything the organization has changed since waits
// in the notice above until somebody decides on it.

const PAGE_SIZE = 25

export function AccessPanel({ batchId }: { batchId: string }) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [failure, setFailure] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ source: AccessSource; name: string } | null>(null)
  const [merging, setMerging] = useState(false)
  const [addingStaff, setAddingStaff] = useState(false)

  // keyset paging walked by page: each cursor is kept as it is handed out,
  // so going back is one we already hold
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined])
  const [at, setAt] = useState(0)
  const access = useQuery(
    query.assessment.listAccess.queryOptions({
      params: { batchId },
      query: {
        ...(cursors[at] !== undefined ? { cursor: cursors[at] } : {}),
        limit: String(PAGE_SIZE),
      },
    }),
  )
  const nextCursor = access.data?.nextCursor ?? null
  useEffect(() => {
    if (nextCursor === null || cursors[at + 1] === nextCursor) return
    setCursors((current) => [...current.slice(0, at + 1), nextCursor])
  }, [nextCursor, at, cursors])
  // the counts only: what changed is read a page at a time inside the dialog
  // that offers it, so this page never renders the list
  const summary = useQuery(
    query.assessment.previewAccessSync.queryOptions({
      params: { batchId },
      query: { limit: '1' },
    }),
  )

  const invalidate = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  const onError = (error: unknown) => setFailure(formatError(error))
  const onMutate = () => setFailure(null)

  const sync = useMutation({
    mutationFn: (selection: AccessSelection) =>
      run(api.assessment.applyAccessSync({ params: { batchId }, payload: selection })),
    onMutate,
    onSuccess: (result: { merged: number; cleared: number }) => {
      setMerging(false)
      toast.success(
        result.merged === 0 && result.cleared > 0
          ? format(m.toastLapsedCleared)
          : format(m.toastMerged, { count: result.merged }),
      )
      invalidate()
    },
    onError,
  })
  // The dialog decides as a whole; the api states one capability at a time.
  // The difference is sent, so a dialog closed without changing anything
  // sends nothing at all.
  const setDeny = useMutation({
    mutationFn: async (input: {
      userId: string
      was: readonly string[]
      now: readonly string[]
    }) => {
      const changes = [
        ...input.now
          .filter((code) => !input.was.includes(code))
          .map((code) => [code, true] as const),
        ...input.was
          .filter((code) => !input.now.includes(code))
          .map((code) => [code, false] as const),
      ]
      for (const [permission, denied] of changes) {
        await run(
          api.assessment.setAccessDeny({
            params: { batchId, userId: input.userId, permission },
            payload: { denied },
          }),
        )
      }
    },
    onMutate,
    onSuccess: () => {
      setAdjusting(null)
      toast.success(format(m.toastAdjusted))
      invalidate()
    },
    onError,
  })
  const addStaff = useMutation({
    mutationFn: (input: {
      userIds: readonly string[]
      orgNodeIds: readonly string[]
      roleId: string
    }) =>
      run(
        api.assessment.addStaff({
          params: { batchId },
          payload: {
            userIds: [...input.userIds],
            orgNodeIds: [...input.orgNodeIds],
            roleId: input.roleId,
          },
        }),
      ),
    onMutate,
    onSuccess: () => {
      setAddingStaff(false)
      toast.success(format(m.toastStaffAdded))
      invalidate()
    },
    onError,
  })
  const remove = useMutation({
    mutationFn: (sourceId: string) =>
      run(api.assessment.removeStaff({ params: { batchId, sourceId } })),
    onMutate,
    onSuccess: () => {
      setRemoving(null)
      toast.success(format(m.toastStaffRemoved))
      invalidate()
    },
    onError,
  })

  const staff = access.data?.staff ?? []
  const subject = staff.find((row) => row.userId === adjusting)

  return (
    <div className="space-y-5">
      <Feedback message={failure} />

      {summary.data && (
        <AccessSyncNotice
          pendingTotal={summary.data.pendingTotal}
          lapsedTotal={summary.data.lapsedTotal}
          onOpen={() => setMerging(true)}
        />
      )}

      <AccessSyncDialog
        batchId={batchId}
        open={merging}
        pending={sync.isPending}
        onMerge={(selection) => sync.mutate(selection)}
        onClose={() => setMerging(false)}
      />

      <section aria-label={format(m.tabAccess)} className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{format(m.tabAccess)}</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {format(m.accessSourceCount, { count: staff.length })}
            </span>
            <Button size="sm" variant="outline" onClick={() => setAddingStaff(true)}>
              {format(m.addStaff)}
            </Button>
          </div>
        </div>

        <AsyncSection
          pending={access.isPending}
          error={access.isError ? formatError(access.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void access.refetch()}
          skeleton={
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          }
        >
          {staff.length === 0 ? (
            <Empty className="rounded-lg border border-dashed">
              <EmptyHeader>
                <EmptyTitle>{format(m.accessEmpty)}</EmptyTitle>
                <EmptyDescription>{format(m.accessEmptyHint)}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[26%]">{format(m.accessColumnPerson)}</TableHead>
                    <TableHead className="w-[28%]">{format(m.accessColumnSources)}</TableHead>
                    <TableHead>{format(m.accessColumnPermissions)}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staff.map((row) => (
                    <SubjectRow
                      key={row.userId}
                      subject={row}
                      onAdjust={() => setAdjusting(row.userId)}
                      onRemove={(source) => setRemoving({ source, name: row.displayName })}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </AsyncSection>

        {(at > 0 || nextCursor !== null) && (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={at === 0}
              onClick={() => setAt((page) => Math.max(0, page - 1))}
            >
              {format(m.previousPage)}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={nextCursor === null}
              onClick={() => setAt((page) => page + 1)}
            >
              {format(m.nextPage)}
            </Button>
          </div>
        )}
      </section>

      {/* mounted whether or not it is open: unmounting it the moment the
          answer arrives cuts its closing animation off at the knees */}
      <AccessAdjustDialog
        subject={subject ?? null}
        open={subject !== undefined}
        pending={setDeny.isPending}
        onSave={(denied) =>
          subject && setDeny.mutate({ userId: subject.userId, was: subject.denied, now: denied })
        }
        onClose={() => setAdjusting(null)}
      />

      <AddStaffDialog
        batchId={batchId}
        open={addingStaff}
        pending={addStaff.isPending}
        onAdd={(input) => addStaff.mutate(input)}
        onClose={() => setAddingStaff(false)}
      />

      <ConfirmDialog
        open={removing !== null}
        title={format(m.accessRemoveTitle, { name: removing?.name ?? '' })}
        description={format(m.accessRemoveBody)}
        confirmLabel={format(m.accessRemove)}
        cancelLabel={format(commonMessages.cancel)}
        pending={remove.isPending}
        tone="destructive"
        onConfirm={() => removing && remove.mutate(removing.source.sourceId)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}

function SubjectRow({
  subject,
  onAdjust,
  onRemove,
}: {
  subject: AccessSubject
  onAdjust: () => void
  onRemove: (source: AccessSource) => void
}) {
  const { format } = useI18n()
  const denied = inCatalogOrder(subject.denied)

  return (
    <TableRow>
      <TableCell>
        {/* whoever owns people decides what a reader may learn about one; this
            screen only knows the name it was going to print anyway */}
        <UiSlot
          token={personCard}
          context={{
            userId: subject.userId,
            displayName: subject.displayName,
            businessNo: subject.businessNo,
          }}
          fallback={
            <PersonCell
              name={subject.displayName}
              secondary={subject.businessNo ?? format(m.noBusinessNoShort)}
            />
          }
        />
      </TableCell>
      <TableCell>
        <ul className="flex flex-col gap-1">
          {subject.sources.map((source) => (
            <li key={source.sourceId} className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm">{source.roleName}</span>
              <Badge
                data-testid="access-origin"
                data-origin={source.origin}
                variant={source.origin === 'explicit' ? 'outline' : 'secondary'}
              >
                {format(
                  source.origin === 'explicit' ? m.accessOriginExplicit : m.accessOriginInherited,
                )}
              </Badge>
              {/* the assignment behind it is gone, so it grants nothing; the
                  row stays because the round's own record of it stays */}
              {!source.active && (
                <span className="text-xs text-muted-foreground">
                  {format(m.accessSourceLapsed)}
                </span>
              )}
              {/* only what this round handed out itself: an inherited
                  assignment belongs to the organization, and refusing what it
                  offers is what withholding is for */}
              {source.origin === 'explicit' && subject.manageable && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground"
                  aria-label={format(m.accessRemove)}
                  title={format(m.accessRemove)}
                  onClick={() => onRemove(source)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </TableCell>
      <TableCell>
        {subject.effective.length === 0 && denied.length === 0 ? (
          <span className="text-sm text-muted-foreground">{format(m.accessNothing)}</span>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-1">
              {inCatalogOrder(subject.effective).map((code) => (
                <Badge key={code} variant="secondary" className="font-normal">
                  {format(permissionLabel(code))}
                </Badge>
              ))}
              {subject.effective.length === 0 && (
                <span className="text-sm text-muted-foreground">{format(m.accessNothing)}</span>
              )}
            </div>
            {/* what was taken away is said here rather than left as an
                absence: a shorter list of chips looks like nothing happened */}
            {denied.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">
                  {format(m.accessDeniedCount, { count: denied.length })}
                </span>
                {denied.map((code) => (
                  <Badge
                    key={code}
                    variant="outline"
                    className="font-normal text-muted-foreground line-through"
                  >
                    {format(permissionLabel(code))}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        {/* their own row: the server refuses it too, this is so nobody is
            offered a button that answers with a refusal */}
        {subject.manageable && (
          <Button size="sm" variant="ghost" onClick={onAdjust}>
            {format(m.accessAdjust)}
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
