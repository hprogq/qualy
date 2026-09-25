import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@qualy/ui/empty'
import { PersonCell } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { Card, Cell, Table, TableHead, TableRow } from '@qualy/ui/screen'
import { useIsBelow } from '@qualy/ui/use-mobile'
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

/** person, where the duty comes from, what it grants, and the way to change it */
const STAFF_COLUMNS = 'minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1.4fr) 6rem'

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 20 },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 14, lineHeight: '1.25rem', fontWeight: 600 },
  headSide: { display: 'flex', alignItems: 'center', gap: 12 },
  aside: { fontSize: 12, lineHeight: '1rem', color: tokens.mutedForeground },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  waiting: { display: 'flex', flexDirection: 'column', gap: 8 },
  waitingRow: { height: 48, width: '100%' },
  frame: {
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  frameEmpty: { borderStyle: 'dashed' },

  pager: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  sources: { display: 'flex', flexDirection: 'column', gap: 4 },
  source: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 6 },
  roleName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  drop: { width: 24, height: 24, color: tokens.mutedForeground },
  dropIcon: { width: 14, height: 14 },
  permissions: { display: 'flex', flexDirection: 'column', gap: 6 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  withheld: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  chip: { fontWeight: 400 },
  chipStruck: {
    fontWeight: 400,
    color: tokens.mutedForeground,
    textDecorationLine: 'line-through',
  },
  // one person as a card of their own, where a row of four columns is not
  // a shape a phone has
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 14,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  cardHead: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 10 },
  cardWho: { display: 'flex', minWidth: 0, flexGrow: 1 },
  cardBlock: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 5 },
  cardLabel: {
    fontSize: 11.5,
    fontWeight: 500,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  // A row here carries two lists, not two words, so it stands taller than a
  // table's own floor - and a floor gives no air at all once the content is
  // past it.
  roomy: { paddingBlock: 12 },
  endCell: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginInlineStart: { default: null, [breakpoints.phone]: 'auto' },
  },
})

export function AccessPanel({
  batchId,
  archived,
}: {
  batchId: string
  /**
   * An archived round takes on nobody new and no more of anybody: the
   * server refuses appointing, accepting and lifting a withholding there,
   * so none of them is offered. Taking authority away stays open.
   */
  archived: boolean
}) {
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
      void invalidate()
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
      void invalidate()
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
      void invalidate()
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
      void invalidate()
    },
    onError,
  })

  const staff = access.data?.staff ?? []
  const subject = staff.find((row) => row.userId === adjusting)

  return (
    <div {...stylex.props(styles.page)}>
      <Feedback message={failure} />

      {summary.data && (
        <AccessSyncNotice
          pendingTotal={archived ? 0 : summary.data.pendingTotal}
          lapsedTotal={summary.data.lapsedTotal}
          onOpen={() => setMerging(true)}
        />
      )}

      <AccessSyncDialog
        batchId={batchId}
        archived={archived}
        open={merging}
        pending={sync.isPending}
        onMerge={(selection) => sync.mutate(selection)}
        onClose={() => setMerging(false)}
      />

      <section aria-label={format(m.tabAccess)} {...stylex.props(styles.section)}>
        <div {...stylex.props(styles.head)}>
          <h3 {...stylex.props(styles.title)}>{format(m.tabAccess)}</h3>
          <div {...stylex.props(styles.headSide)}>
            <span {...stylex.props(styles.aside)}>
              {format(m.accessSourceCount, { count: staff.length })}
            </span>
            {!archived && (
              <Button size="sm" variant="outline" onClick={() => setAddingStaff(true)}>
                {format(m.addStaff)}
              </Button>
            )}
          </div>
        </div>

        <AsyncSection
          pending={access.isPending}
          error={access.isError ? formatError(access.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void access.refetch()}
          skeleton={
            <div {...stylex.props(styles.waiting)}>
              <Skeleton className={stylex.props(styles.waitingRow).className} />
              <Skeleton className={stylex.props(styles.waitingRow).className} />
            </div>
          }
        >
          {staff.length === 0 ? (
            <Empty className={stylex.props(styles.frame, styles.frameEmpty).className}>
              <EmptyHeader>
                <EmptyTitle>{format(m.accessEmpty)}</EmptyTitle>
                {!archived && <EmptyDescription>{format(m.accessEmptyHint)}</EmptyDescription>}
              </EmptyHeader>
            </Empty>
          ) : (
            /* the product's own table rather than a second one written
               here: narrow, its rows stack into a name with its facts under
               it, which four columns of chips squeezed into 390px never did */
            <Card>
              <Table columns={STAFF_COLUMNS}>
                <TableHead>
                  <span>{format(m.accessColumnPerson)}</span>
                  <span>{format(m.accessColumnSources)}</span>
                  <span>{format(m.accessColumnPermissions)}</span>
                  <span />
                </TableHead>
                {staff.map((row) => (
                  <SubjectRow
                    key={row.userId}
                    subject={row}
                    onAdjust={() => setAdjusting(row.userId)}
                    onRemove={(source) => setRemoving({ source, name: row.displayName })}
                  />
                ))}
              </Table>
            </Card>
          )}
        </AsyncSection>

        {(at > 0 || nextCursor !== null) && (
          <div {...stylex.props(styles.pager)}>
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
        archived={archived}
        open={subject !== undefined}
        pending={setDeny.isPending}
        onSave={(denied) =>
          subject && setDeny.mutate({ userId: subject.userId, was: subject.denied, now: denied })
        }
        onClose={() => setAdjusting(null)}
      />

      <AddStaffDialog
        batchId={batchId}
        open={addingStaff && !archived}
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
  const businessNo = useTerm(authTerms.businessNumber)
  const phone = useIsBelow(768)
  const denied = inCatalogOrder(subject.denied)

  // whoever owns people decides what a reader may learn about one; this
  // screen only knows the name it was going to print anyway
  const who = (
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
          secondary={subject.businessNo ?? format(m.noBusinessNoShort, { businessNo })}
        />
      }
    />
  )

  const sourceList = (
    <ul {...stylex.props(styles.sources)}>
      {subject.sources.map((source) => (
        <li key={source.sourceId} {...stylex.props(styles.source)}>
          <span {...stylex.props(styles.roleName)}>{source.roleName}</span>
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
            <span {...stylex.props(styles.aside)}>{format(m.accessSourceLapsed)}</span>
          )}
          {/* only what this round handed out itself: an inherited
              assignment belongs to the organization, and refusing what it
              offers is what withholding is for */}
          {source.origin === 'explicit' && subject.manageable && (
            <Button
              size="icon"
              variant="ghost"
              className={stylex.props(styles.drop).className}
              aria-label={format(m.accessRemove)}
              title={format(m.accessRemove)}
              onClick={() => onRemove(source)}
            >
              <XIcon {...stylex.props(styles.dropIcon)} />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )

  const permissionList =
    subject.effective.length === 0 && denied.length === 0 ? (
      <span {...stylex.props(styles.quiet)}>{format(m.accessNothing)}</span>
    ) : (
      <div {...stylex.props(styles.permissions)}>
        <div {...stylex.props(styles.chips)}>
          {inCatalogOrder(subject.effective).map((code) => (
            <Badge key={code} variant="secondary" className={stylex.props(styles.chip).className}>
              {format(permissionLabel(code))}
            </Badge>
          ))}
          {subject.effective.length === 0 && (
            <span {...stylex.props(styles.quiet)}>{format(m.accessNothing)}</span>
          )}
        </div>
        {/* what was taken away is said here rather than left as an
            absence: a shorter list of chips looks like nothing happened */}
        {denied.length > 0 && (
          <div {...stylex.props(styles.withheld)}>
            <span {...stylex.props(styles.aside)}>
              {format(m.accessDeniedCount, { count: denied.length })}
            </span>
            {denied.map((code) => (
              <Badge
                key={code}
                variant="outline"
                className={stylex.props(styles.chipStruck).className}
              >
                {format(permissionLabel(code))}
              </Badge>
            ))}
          </div>
        )}
      </div>
    )

  // their own row: the server refuses it too, this is so nobody is offered a
  // button that answers with a refusal
  const adjust = subject.manageable && (
    <Button size="sm" variant={phone ? 'outline' : 'ghost'} onClick={onAdjust}>
      {format(m.accessAdjust)}
    </Button>
  )

  // Narrow, what somebody holds is not a row of a table. It is three blocks
  // of their own - who they are, where the duty comes from, what it grants -
  // and the last two are lists, not values. Put through a stacked row they
  // were two lists ruled off from each other on one line, with the press
  // that changes them standing among the facts.
  if (phone) {
    return (
      <div {...stylex.props(styles.card)} data-testid="access-card">
        <div {...stylex.props(styles.cardHead)}>
          <span {...stylex.props(styles.cardWho)}>{who}</span>
          {adjust}
        </div>
        <div {...stylex.props(styles.cardBlock)}>
          <span {...stylex.props(styles.cardLabel)}>{format(m.accessColumnSources)}</span>
          {sourceList}
        </div>
        <div {...stylex.props(styles.cardBlock)}>
          <span {...stylex.props(styles.cardLabel)}>{format(m.accessColumnPermissions)}</span>
          {permissionList}
        </div>
      </div>
    )
  }

  return (
    <TableRow xstyle={styles.roomy}>
      <Cell lead>{who}</Cell>
      <Cell>{sourceList}</Cell>
      <Cell>{permissionList}</Cell>
      <span {...stylex.props(styles.endCell)}>{adjust}</span>
    </TableRow>
  )
}
