import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, EllipsisIcon, MinusIcon, PlusIcon, SearchXIcon, UsersIcon } from 'lucide-react'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { toast } from '@qualy/ui/toast'
import { Pager } from '@qualy/ui/pager'
import { PersonCell } from '@qualy/ui/person'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import {
  Blank,
  Card,
  CardFoot,
  Cell,
  SearchField,
  Status,
  Table,
  TableHead,
  TableRow,
  TableSkeleton,
  Tag,
} from '@qualy/ui/screen'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { personCard } from '@qualy/ui-contract'
import { BATCH_STAFF_CODES } from '../../permissions.ts'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { AccessAdjustDialog } from './AccessAdjustDialog.tsx'
import { AccessSyncDialog } from './AccessSyncDialog.tsx'
import { AddStaffDialog } from './AddStaffDialog.tsx'
import { AccessSyncNotice } from './AccessSyncNotice.tsx'
import { inCatalogOrder, permissionLabel, permissionShort, type StaffCode } from './permissions.ts'
import { ACCESS_PAGE_SIZE, accessQueryOf, narrowed, useAccessView } from './view.ts'
import {
  adjustableOf,
  type AccessSelection,
  type AccessSource,
  type AccessSubject,
} from './model.ts'

// Who may work on this round, and on whose authority.
//
// Not a list of roles: a role is the organization's word for what somebody
// generally does, and this page is about what this round accepted of it. The
// two can differ, and the difference is the whole point - so the table says
// what holds today, and everything the organization has changed since waits
// in the notice above until somebody decides on it.
//
// Where there is the width, what each person may do is a grid of the six
// things a round hands out, so "who may review here" is read down one
// column. Narrower it is the same facts as a line of words, and on a phone
// every person is a card of their own.

/** the grid's own width: below it the six columns would squeeze the names out */
const MATRIX_AT = 1060

/** person, role and scope, the six capabilities, and the way to change them */
const MATRIX_COLUMNS = `minmax(8.5rem, 1fr) minmax(12rem, 1.5fr) repeat(${String(BATCH_STAFF_CODES.length)}, 4.75rem) 7rem`
/** person, role and scope, what it grants, and the way to change it */
const LIST_COLUMNS = 'minmax(8.5rem, 0.9fr) minmax(0, 1.3fr) minmax(0, 1.2fr) 7rem'

const LAPSE_WORDS = {
  revoked: m.accessLapseRevoked,
  expired: m.accessLapseExpired,
  inapplicable: m.accessLapseInapplicable,
} as const

const STANDING_WORDS = {
  active: m.accessStandingActive,
  lapsed: m.accessStandingLapsed,
  withheld: m.accessStandingWithheld,
} as const

/** the value a select holds for "no narrowing": an empty string is not an item */
const ALL = '*'

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 16 },
  section: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 12 },
  // One row from a tablet up; on a phone the search takes a line, the three
  // choices share the next and the way to add somebody the one after.
  toolbar: {
    display: 'flex',
    flexWrap: { default: 'nowrap', [breakpoints.phone]: 'wrap' },
    alignItems: 'center',
    gap: 8,
  },
  search: {
    minWidth: { default: '9rem', [breakpoints.phone]: 0 },
    maxWidth: { default: '18rem', [breakpoints.phone]: 'none' },
    width: { default: 'auto', [breakpoints.phone]: '100%' },
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: { default: '12rem', [breakpoints.phone]: 'auto' },
  },
  choice: {
    width: { default: '10rem', [breakpoints.phone]: 'auto' },
    minWidth: { default: '6.5rem', [breakpoints.phone]: 0 },
    flexGrow: { default: 0, [breakpoints.phone]: 1 },
    flexShrink: 4,
    flexBasis: { default: null, [breakpoints.phone]: '0%' },
  },
  spacer: { flexGrow: 1, display: { default: 'block', [breakpoints.phone]: 'none' } },
  add: { flexShrink: 0, width: { default: 'auto', [breakpoints.phone]: '100%' } },
  addIcon: { width: 15, height: 15 },

  // ---- one person -----------------------------------------------------
  sources: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
    margin: 0,
    padding: 0,
    listStyleType: 'none',
  },
  // the role, where it is held, and - only when it is not the rule - whose
  // doing it was and why it grants nothing any more
  source: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  role: {
    flexShrink: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.foreground,
  },
  roleSpent: { color: tokens.mutedForeground, textDecorationLine: 'line-through' },
  unit: {
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: QUIET,
  },
  rule: {
    flexShrink: 0,
    width: 1,
    height: 10,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
  },
  marks: { display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: 6 },
  // what somebody may do, as a line of words
  grants: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 2,
    fontSize: 12.5,
    lineHeight: 1.6,
    color: tokens.foreground,
  },
  grantOff: { color: QUIET, textDecorationLine: 'line-through' },
  none: { fontSize: 12.5, color: QUIET },
  // ... and as a grid, one column per capability
  cellMark: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: 20,
  },
  granted: { width: 16, height: 16, color: tokens.primary },
  withheld: { width: 14, height: 14, color: QUIET },
  headWord: {
    display: 'block',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'center',
  },
  // somebody who can do nothing here any more: still listed, a record to
  // clear rather than a colleague to find, and drawn as one
  idle: { opacity: 0.62 },
  // a row carries a list of roles, not one word, so it takes the air a
  // floor alone would not give it
  roomy: { paddingBlock: 10 },
  acts: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
  },
  menuWhere: { marginInlineStart: 6, color: QUIET },

  // one person as a card of their own, where a row of columns is not a
  // shape a phone has
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
  cardLabel: { fontSize: 11.5, fontWeight: 500, color: QUIET },
  blank: { minHeight: '18rem', borderWidth: 0 },
})

/** how wide an element is, as it changes */
function useWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (element === null) return
    const measure = () => setWidth(element.getBoundingClientRect().width)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [element])
  return width
}

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
  const businessNo = useTerm(authTerms.businessNumber)
  const [failure, setFailure] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ source: AccessSource; subject: AccessSubject } | null>(
    null,
  )
  const [merging, setMerging] = useState(false)
  const [addingStaff, setAddingStaff] = useState(false)
  const [view, onView] = useAccessView()

  // Typing does not fire a request per keystroke. What the box last asked
  // the address for is remembered, so an address that moves by itself - the
  // back button, a link - moves the box, rather than the box writing its
  // old words back over it.
  const [draft, setDraft] = useState(view.q)
  const asked = useRef(view.q)
  useEffect(() => {
    if (view.q === asked.current) return
    asked.current = view.q
    setDraft(view.q)
  }, [view.q])
  useEffect(() => {
    if (draft === asked.current) return
    const timer = setTimeout(() => {
      asked.current = draft
      onView({ q: draft })
    }, 300)
    return () => clearTimeout(timer)
  }, [draft, onView])

  const access = useQuery({
    ...query.assessment.listAccess.queryOptions({
      params: { batchId },
      query: accessQueryOf(view),
    }),
    // the page being left stays up until the next one arrives, so turning a
    // page or narrowing the list does not blank the table
    placeholderData: keepPreviousData,
  })
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

  const [seat, setSeat] = useState<HTMLElement | null>(null)
  const width = useWidth(seat)
  const phone = useIsBelow(768)
  const shape = phone ? 'cards' : width >= MATRIX_AT ? 'matrix' : 'list'

  const staff = access.data?.staff ?? []
  const total = access.data?.total ?? 0
  const page = access.data?.page ?? view.page
  const roles = access.data?.roles ?? []
  const subject = staff.find((row) => row.userId === adjusting)
  const lapsedTotal = summary.data?.lapsedTotal ?? 0
  // what removing a source leaves the person with, said before it is done
  const othersRemain =
    removing !== null &&
    removing.subject.sources.some(
      (source) => source.sourceId !== removing.source.sourceId && source.active,
    )

  const toolbar = (
    <div {...stylex.props(styles.toolbar)} data-testid="access-toolbar">
      <SearchField
        name="access-search"
        value={draft}
        onChange={setDraft}
        label={format(m.rosterSearch, { businessNo })}
        xstyle={styles.search}
      />
      <Select
        value={view.roleId === '' ? ALL : view.roleId}
        onValueChange={(next) => onView({ roleId: next === ALL ? '' : next })}
      >
        <SelectTrigger
          aria-label={format(m.accessFilterRole)}
          data-testid="access-filter-role"
          xstyle={styles.choice}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{format(m.accessFilterRoleAny)}</SelectItem>
          {roles.map((role) => (
            <SelectItem key={role.id} value={role.id}>
              {role.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={view.permission === '' ? ALL : view.permission}
        onValueChange={(next) => onView({ permission: next === ALL ? '' : (next as StaffCode) })}
      >
        <SelectTrigger
          aria-label={format(m.accessFilterPermission)}
          data-testid="access-filter-permission"
          xstyle={styles.choice}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{format(m.accessFilterPermissionAny)}</SelectItem>
          {BATCH_STAFF_CODES.map((code) => (
            <SelectItem key={code} value={code}>
              {format(permissionLabel(code))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={view.standing === '' ? ALL : view.standing}
        onValueChange={(next) =>
          onView({ standing: next === ALL ? '' : (next as keyof typeof STANDING_WORDS) })
        }
      >
        <SelectTrigger
          aria-label={format(m.accessFilterStanding)}
          data-testid="access-filter-standing"
          xstyle={styles.choice}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{format(m.accessFilterStandingAny)}</SelectItem>
          {(Object.keys(STANDING_WORDS) as (keyof typeof STANDING_WORDS)[]).map((standing) => (
            <SelectItem key={standing} value={standing}>
              {format(STANDING_WORDS[standing])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span {...stylex.props(styles.spacer)} />
      {!archived && (
        <Button
          size="sm"
          variant="outline"
          className={stylex.props(styles.add).className}
          onClick={() => setAddingStaff(true)}
        >
          <PlusIcon aria-hidden {...stylex.props(styles.addIcon)} />
          {format(m.addStaff)}
        </Button>
      )}
    </div>
  )

  const rows = staff.map((row) => (
    <SubjectRow
      key={row.userId}
      subject={row}
      shape={shape}
      onAdjust={() => setAdjusting(row.userId)}
      onRemove={(source) => setRemoving({ source, subject: row })}
    />
  ))

  const list =
    staff.length === 0 ? (
      narrowed(view) ? (
        <Card data-testid="access-blank" data-kind="no-match">
          <Blank
            icon={<SearchXIcon />}
            title={format(m.accessNoMatch)}
            xstyle={styles.blank}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft('')
                  asked.current = ''
                  onView({ q: '', roleId: '', permission: '', standing: '' })
                }}
              >
                {format(m.accessClearFilters)}
              </Button>
            }
          />
        </Card>
      ) : (
        <Card data-testid="access-blank" data-kind="empty">
          <Blank
            icon={<UsersIcon />}
            title={format(m.accessEmpty)}
            {...(archived ? {} : { description: format(m.accessEmptyHint) })}
            xstyle={styles.blank}
            action={
              archived ? undefined : (
                <Button variant="outline" size="sm" onClick={() => setAddingStaff(true)}>
                  <PlusIcon aria-hidden {...stylex.props(styles.addIcon)} />
                  {format(m.addStaff)}
                </Button>
              )
            }
          />
        </Card>
      )
    ) : (
      <Card data-testid="access-staff" data-shape={shape} data-total={total}>
        {shape === 'cards' ? (
          <div>{rows}</div>
        ) : shape === 'matrix' ? (
          <Table columns={MATRIX_COLUMNS}>
            <TableHead>
              <span>{format(m.accessColumnPerson)}</span>
              <span>{format(m.accessColumnRoles)}</span>
              {BATCH_STAFF_CODES.map((code) => (
                <span
                  key={code}
                  title={format(permissionLabel(code))}
                  {...stylex.props(styles.headWord)}
                >
                  {format(permissionShort(code))}
                </span>
              ))}
              <span />
            </TableHead>
            {rows}
          </Table>
        ) : (
          <Table columns={LIST_COLUMNS}>
            <TableHead>
              <span>{format(m.accessColumnPerson)}</span>
              <span>{format(m.accessColumnRoles)}</span>
              <span>{format(m.accessColumnPermissions)}</span>
              <span />
            </TableHead>
            {rows}
          </Table>
        )}
        <CardFoot>
          <Pager
            testId="access-pager"
            label={format(m.accessPagerLabel)}
            page={page}
            pageSize={ACCESS_PAGE_SIZE}
            total={total}
            disabled={access.isFetching}
            summary={format(m.rosterPageSummary, {
              from: (page - 1) * ACCESS_PAGE_SIZE + 1,
              to: (page - 1) * ACCESS_PAGE_SIZE + staff.length,
              total,
            })}
            onPage={(next) => onView({ page: next })}
          />
        </CardFoot>
      </Card>
    )

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

      <section ref={setSeat} aria-label={format(m.tabAccess)} {...stylex.props(styles.section)}>
        {toolbar}
        <AsyncSection
          pending={access.isPending}
          error={access.isError ? formatError(access.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void access.refetch()}
          skeleton={
            <Card>
              <TableSkeleton rows={6} />
            </Card>
          }
        >
          {list}
        </AsyncSection>
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
        // the one place a lapsed record can be cleared, offered where a
        // reader found there was nothing left to adjust
        {...(lapsedTotal > 0
          ? {
              onReview: () => {
                setAdjusting(null)
                setMerging(true)
              },
            }
          : {})}
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
        title={format(m.accessRemoveTitle, {
          name: removing?.subject.displayName ?? '',
          role: removing?.source.roleName ?? '',
        })}
        description={format(othersRemain ? m.accessRemoveBodyKept : m.accessRemoveBody, {
          name: removing?.subject.displayName ?? '',
        })}
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
  shape,
  onAdjust,
  onRemove,
}: {
  subject: AccessSubject
  shape: 'matrix' | 'list' | 'cards'
  onAdjust: () => void
  onRemove: (source: AccessSource) => void
}) {
  const { format } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const effective = new Set(subject.effective)
  const denied = new Set(subject.denied)
  const idle = subject.effective.length === 0
  // their own row, or nothing left to adjust: the server refuses the first
  // and the second would open onto an empty dialog
  const adjustable = subject.manageable && adjustableOf(subject).length > 0
  const removable = subject.sources.filter((source) => source.removable)

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
        <SourceLine key={source.sourceId} source={source} />
      ))}
    </ul>
  )

  // what they may do, as words: the ones in force, then the ones this round
  // turned off, struck through - a shorter line looks like nothing happened
  const inForce = inCatalogOrder(subject.effective)
  const turnedOff = inCatalogOrder(subject.denied)
  const grants =
    inForce.length === 0 && turnedOff.length === 0 ? (
      <span {...stylex.props(styles.none)} data-testid="access-none">
        {format(m.accessNoPermission)}
      </span>
    ) : (
      <span {...stylex.props(styles.grants)}>
        {inForce.map((code) => (
          <span key={code} data-testid="access-grant" data-permission={code} data-state="granted">
            {format(permissionLabel(code))}
          </span>
        ))}
        {turnedOff.map((code) => (
          <span
            key={code}
            data-testid="access-grant"
            data-permission={code}
            data-state="withheld"
            title={format(m.accessWithheldMark)}
            {...stylex.props(styles.grantOff)}
          >
            {format(permissionLabel(code))}
            <VisuallyHidden>{format(m.accessWithheldMark)}</VisuallyHidden>
          </span>
        ))}
        {inForce.length === 0 && (
          <span {...stylex.props(styles.none)} data-testid="access-none">
            {format(m.accessNoPermission)}
          </span>
        )}
      </span>
    )

  const acts = (
    <span {...stylex.props(styles.acts)}>
      {adjustable && (
        <Button size="sm" variant={shape === 'cards' ? 'outline' : 'ghost'} onClick={onAdjust}>
          {format(m.accessAdjust)}
        </Button>
      )}
      {/* Taking back what this round handed out, one appointment at a time,
          a press further in than the facts: a cross beside a role name was
          a press away from reading it */}
      {removable.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              data-testid="access-actions"
              aria-label={format(m.accessRowActions, { name: subject.displayName })}
            >
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {removable.map((source) => (
              <DropdownMenuItem
                key={source.sourceId}
                variant="destructive"
                data-testid="access-remove"
                data-source={source.sourceId}
                onSelect={() => onRemove(source)}
              >
                {format(m.accessRemoveSource, { role: source.roleName })}
                {source.orgNodeName !== null && (
                  <span {...stylex.props(styles.menuWhere)}>{source.orgNodeName}</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  )

  const dim = (node: ReactNode) =>
    idle ? <span {...stylex.props(styles.idle)}>{node}</span> : node
  const facts = {
    'data-testid': 'access-subject',
    'data-user': subject.userId,
    'data-idle': idle,
    'data-adjustable': adjustable,
  }

  // Narrow, what somebody holds is not a row of a table. It is three blocks
  // of their own - who they are, where the duty comes from, what it grants -
  // and the last two are lists, not values.
  if (shape === 'cards') {
    return (
      <div {...stylex.props(styles.card)} {...facts}>
        <div {...stylex.props(styles.cardHead)}>
          <span {...stylex.props(styles.cardWho)}>{dim(who)}</span>
          {acts}
        </div>
        <div {...stylex.props(styles.cardBlock)}>
          <span {...stylex.props(styles.cardLabel)}>{format(m.accessColumnRoles)}</span>
          {sourceList}
        </div>
        <div {...stylex.props(styles.cardBlock)}>
          <span {...stylex.props(styles.cardLabel)}>{format(m.accessColumnPermissions)}</span>
          {dim(grants)}
        </div>
      </div>
    )
  }

  if (shape === 'matrix') {
    return (
      <TableRow xstyle={styles.roomy} {...facts}>
        <Cell lead>{dim(who)}</Cell>
        <Cell>{sourceList}</Cell>
        {BATCH_STAFF_CODES.map((code) => {
          const state = effective.has(code) ? 'granted' : denied.has(code) ? 'withheld' : 'none'
          return (
            <span
              key={code}
              data-testid="access-grant"
              data-permission={code}
              data-state={state}
              {...(state === 'withheld' ? { title: format(m.accessWithheldMark) } : {})}
              {...stylex.props(styles.cellMark)}
            >
              {state === 'granted' && <CheckIcon aria-hidden {...stylex.props(styles.granted)} />}
              {state === 'withheld' && <MinusIcon aria-hidden {...stylex.props(styles.withheld)} />}
              {state !== 'none' && (
                <VisuallyHidden>
                  {format(permissionLabel(code))}
                  {state === 'withheld' ? format(m.accessWithheldMark) : ''}
                </VisuallyHidden>
              )}
            </span>
          )
        })}
        {acts}
      </TableRow>
    )
  }

  return (
    <TableRow xstyle={styles.roomy} {...facts}>
      <Cell lead>{dim(who)}</Cell>
      <Cell>{sourceList}</Cell>
      <Cell>{dim(grants)}</Cell>
      {acts}
    </TableRow>
  )
}

/**
 * One role this person holds or held, and where.
 *
 * The organization's appointment is the rule and says nothing about itself;
 * one this round made on its own is marked, and one that grants nothing any
 * more says why - withdrawn, run out, or no longer one this round can take.
 */
function SourceLine({ source }: { source: AccessSource }) {
  const { format } = useI18n()
  const role = source.roleName === '' ? format(m.accessRoleUnknown) : source.roleName
  return (
    <li
      data-testid="access-source"
      data-source={source.sourceId}
      data-origin={source.origin}
      data-active={source.active}
      data-lapse={source.lapse ?? ''}
      {...stylex.props(styles.source)}
    >
      <span {...stylex.props(styles.role, !source.active && styles.roleSpent)} title={role}>
        {role}
      </span>
      {source.orgNodeName !== null && (
        <>
          <span aria-hidden {...stylex.props(styles.rule)} />
          <span {...stylex.props(styles.unit)} title={source.orgNodeName}>
            {source.orgNodeName}
          </span>
        </>
      )}
      {(source.origin === 'explicit' || source.lapse !== null) && (
        <span {...stylex.props(styles.marks)}>
          {source.origin === 'explicit' && <Tag outline>{format(m.accessOriginExplicit)}</Tag>}
          {source.lapse !== null && (
            <Status tone="warn">{format(LAPSE_WORDS[source.lapse])}</Status>
          )}
        </span>
      )}
    </li>
  )
}
