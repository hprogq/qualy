import type { Effect } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useState } from 'react'
import { ArrowLeftIcon, EllipsisIcon } from 'lucide-react'
import {
  PageLink,
  useApi,
  useApiQuery,
  usePageNavigate,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Skeleton } from '@qualy/ui/skeleton'
import { initialsOf } from '@qualy/ui/person'
import { Status, Tag } from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { rosterSearch } from './users/roster-address.ts'
import { authApi } from '../api.ts'

// Who the open person is, above every section of their record.
//
// The user-detail shell renders this without knowing what a person is; this
// reads the person from the route it is mounted at, the same way the pages
// beside it do. It carries the acts that concern the person as a whole -
// their name, address and kind, whether they may sign in at all, whether
// they stay on the books - and nothing that belongs to one section.

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  // two rows: the way back, then the person. The strip this sits in is the
  // shell's; everything about who this is belongs here.
  band: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 12, width: '100%' },
  backLink: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    height: 26,
    marginLeft: -8,
    paddingInline: 8,
    borderRadius: 8,
    fontSize: 13,
    textDecoration: 'none',
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
  },
  backGlyph: { width: 15, height: 15, flexShrink: 0 },
  // Across, a portrait with the person beside it. On a phone the same four
  // things in three rows, placed rather than wrapped: left to wrap, the
  // block of name and facts asked for more than the line had left, went to
  // a line of its own, and left the portrait sitting alone on the first one.
  who: {
    display: { default: 'flex', [breakpoints.phone]: 'grid' },
    gridTemplateColumns: { default: null, [breakpoints.phone]: 'auto minmax(0, 1fr)' },
    minWidth: 0,
    alignItems: 'center',
    columnGap: { default: 16, [breakpoints.phone]: 12 },
    rowGap: { default: null, [breakpoints.phone]: 10 },
  },
  portrait: {
    width: { default: 52, [breakpoints.phone]: 44 },
    height: { default: 52, [breakpoints.phone]: 44 },
    flexShrink: 0,
    gridColumn: { default: null, [breakpoints.phone]: 1 },
    gridRow: { default: null, [breakpoints.phone]: 1 },
  },
  portraitFace: {
    backgroundColor: tokens.surfaceMuted,
    color: tokens.surfaceMutedForeground,
    fontSize: 19,
    fontWeight: 600,
  },
  // on a phone the name and the facts are placed by the band above rather
  // than stacked inside a box of their own, so the facts can have the width
  // the portrait is not using
  text: {
    display: { default: 'flex', [breakpoints.phone]: 'contents' },
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 6,
  },
  /** the same box while it is still an outline, where there is nothing to place */
  textBones: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 6 },
  nameRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    gridColumn: { default: null, [breakpoints.phone]: 2 },
    gridRow: { default: null, [breakpoints.phone]: 1 },
  },
  name: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 22,
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  // what is true of them at a glance, each under its own small word
  facts: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 14,
    rowGap: 6,
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
    gridRow: { default: null, [breakpoints.phone]: 2 },
  },
  fact: { display: 'inline-flex', minWidth: 0, alignItems: 'baseline', gap: 6, fontSize: 12.5 },
  factLabel: { flexShrink: 0, color: QUIET },
  factValue: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.surfaceMutedForeground,
  },
  factWarn: { color: tokens.warningForeground },
  factRule: {
    width: 1,
    height: 10,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
  },
  actions: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
    gridRow: { default: null, [breakpoints.phone]: 3 },
  },
  moreMenu: { width: 168 },
  danger: { color: tokens.danger },
  pinned: {
    flexShrink: 0,
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
    gridRow: { default: null, [breakpoints.phone]: 3 },
  },
  feedbackSeat: { display: 'flex', flexDirection: 'column', gap: 8 },
  boneName: { width: 160, height: 24, borderRadius: 6 },
  boneMeta: { width: '100%', maxWidth: 320, height: 14, borderRadius: 4 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  fullField: { width: '100%' },
})

export default function UserDetailHeader() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDisable, setConfirmingDisable] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [businessNo, setBusinessNo] = useState('')
  const [email, setEmail] = useState('')
  const [userTypeId, setUserTypeId] = useState('')
  const navigate = usePageNavigate()

  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const options = useQuery({
    ...query.identity.getUserOptions.queryOptions({ query: {} }),
    enabled: editing,
  })
  const record = user.data?.user

  // a different person is a different form, so the draft re-seeds when the
  // record changes or when a save brings back new server state
  useEffect(() => {
    if (!record) return
    setDisplayName(record.displayName)
    setBusinessNo(record.businessNo ?? '')
    setEmail(record.email ?? '')
    setUserTypeId(record.userType.id)
    setFeedback(null)
    setSaved(false)
  }, [record])

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.identity.key() })
  // the one crossing from an effect to a promise on this screen: TanStack
  // needs a promise, and doing so here keeps every call site an effect
  const run = <Variables,>(call: (input: Variables) => Effect.Effect<unknown, unknown>) => ({
    mutationFn: (input: Variables) => runApi(call(input)),
    onMutate: () => {
      setFeedback(null)
      setSaved(false)
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const saveProfile = useMutation({
    ...run(() =>
      api.identity.updateUser({
        params: { userId },
        payload: {
          version: record?.version ?? 1,
          displayName,
          userTypeId,
          businessNo: businessNo.trim() === '' ? undefined : businessNo.trim(),
          // emptied means taken away; the recovery account's is not the
          // form's to send at all
          ...(system ? {} : { email: email.trim() === '' ? null : email.trim() }),
        },
      }),
    ),
    onSuccess: async () => {
      setEditing(false)
      setSaved(true)
      await refresh()
    },
  })
  const setStatus = useMutation({
    ...run((status: 'active' | 'disabled') =>
      api.identity.setUserStatus({
        params: { userId },
        payload: { status, version: record?.version ?? 1 },
      }),
    ),
    onSuccess: async () => {
      setConfirmingDisable(false)
      setSaved(true)
      await refresh()
    },
  })
  // Final: there is no record left to come back to, so the way out is the
  // roster the person was reached from.
  const remove = useMutation({
    ...run(() =>
      api.identity.deleteUser({
        params: { userId },
        query: { version: String(record?.version ?? 1) },
      }),
    ),
    onSuccess: async () => {
      setConfirmingDelete(false)
      await refresh()
      navigate('auth/users', { search: rosterSearch(), replace: true })
    },
  })

  const manageable = record?.manageable ?? false
  // the platform's own account: where it stands and what it signs in with
  // are provisioned, so the form does not offer them
  const system = user.data?.placement.mode === 'tenant-root'
  const userTypes = options.data?.userTypes ?? []

  const facts: { label: string; value: string; warn?: boolean }[] =
    record === undefined
      ? []
      : [
          {
            label: businessNoWord,
            value:
              record.businessNo ?? format(m.personNoBusinessNo, { businessNo: businessNoWord }),
          },
          {
            label: format(m.emailLabel),
            value: record.email ?? format(m.emailNone),
          },
          {
            label: format(m.personPlacement),
            // the unit itself: the whole way down to it is on the profile below
            value: user.data?.orgPath.at(-1)?.name ?? '—',
          },
          {
            label: format(m.rolesLabel),
            value: format(m.grantCount, { count: user.data?.roles.length ?? 0 }),
          },
        ]

  return (
    <div data-testid="user-detail-header" {...stylex.props(styles.band)}>
      <PageLink
        page="auth/users"
        // back to the roster as it was left: its unit, its filter, its page
        search={rosterSearch()}
        className={stylex.props(styles.backLink).className}
      >
        <ArrowLeftIcon className={stylex.props(styles.backGlyph).className} aria-hidden />
        {format(m.backToUsers)}
      </PageLink>

      {user.isError ? (
        <Feedback message={formatError(user.error)} />
      ) : !record ? (
        <div {...stylex.props(styles.who)}>
          <Skeleton className={stylex.props(styles.portrait).className} />
          <div {...stylex.props(styles.textBones)}>
            <Skeleton className={stylex.props(styles.boneName).className} />
            <Skeleton className={stylex.props(styles.boneMeta).className} />
          </div>
        </div>
      ) : (
        <>
          <div {...stylex.props(styles.who)}>
            <Avatar className={stylex.props(styles.portrait).className}>
              <AvatarFallback className={stylex.props(styles.portraitFace).className}>
                {initialsOf(record.displayName)}
              </AvatarFallback>
            </Avatar>
            <div {...stylex.props(styles.text)}>
              <div {...stylex.props(styles.nameRow)}>
                <h1 {...stylex.props(styles.name)}>{record.displayName}</h1>
                <Tag>{record.userType.name}</Tag>
                <Status
                  tone={record.status === 'active' ? 'ok' : 'bad'}
                  data-testid="user-standing"
                  data-status={record.status}
                >
                  {format(record.status === 'disabled' ? m.disabledBadge : m.statusActive)}
                </Status>
              </div>
              <div {...stylex.props(styles.facts)}>
                {facts.map((fact, index) => (
                  <Fragment key={fact.label}>
                    {index > 0 && <span aria-hidden {...stylex.props(styles.factRule)} />}
                    <span {...stylex.props(styles.fact)}>
                      <span {...stylex.props(styles.factLabel)}>{fact.label}</span>
                      <span
                        {...stylex.props(styles.factValue, fact.warn === true && styles.factWarn)}
                      >
                        {fact.value}
                      </span>
                    </span>
                  </Fragment>
                ))}
              </div>
            </div>
            {manageable && (
              <div {...stylex.props(styles.actions)}>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  {format(m.editProfile)}
                </Button>
                {/* moving somebody is a section of their record, with the rules
                      that refuse it said beside the tree; the band only leads there */}
                <Button variant="outline" size="sm" asChild>
                  <PageLink page="auth/user-organization" params={{ userId }}>
                    {format(m.transfer)}
                  </PageLink>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-sm" aria-label={format(m.moreActions)}>
                      <EllipsisIcon aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className={stylex.props(styles.moreMenu).className}
                  >
                    <DropdownMenuItem
                      disabled={setStatus.isPending}
                      onSelect={() =>
                        record.status === 'active'
                          ? setConfirmingDisable(true)
                          : setStatus.mutate('active')
                      }
                    >
                      {format(record.status === 'active' ? m.disable : m.enable)}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className={stylex.props(styles.danger).className}
                      disabled={remove.isPending}
                      onSelect={() => setConfirmingDelete(true)}
                    >
                      {format(m.deleteAction)}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
          {(feedback !== null || saved) && (
            <div {...stylex.props(styles.feedbackSeat)}>
              <Feedback message={feedback} />
              {saved && feedback === null && <Feedback message={format(m.saved)} tone="success" />}
            </div>
          )}

          <FormDialog
            open={editing}
            title={format(m.editProfile)}
            onClose={() => setEditing(false)}
            footer={
              <>
                <Button variant="outline" onClick={() => setEditing(false)}>
                  {format(m.cancel)}
                </Button>
                <Button
                  type="submit"
                  form="edit-profile"
                  disabled={saveProfile.isPending || displayName.trim() === ''}
                >
                  {format(m.save)}
                </Button>
              </>
            }
          >
            <form
              id="edit-profile"
              {...stylex.props(styles.form)}
              onSubmit={(event) => {
                event.preventDefault()
                saveProfile.mutate(undefined)
              }}
            >
              <Field label={format(m.nameLabel)}>
                {(id) => (
                  <Input
                    id={id}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                )}
              </Field>
              <Field label={businessNoWord}>
                {(id) => (
                  <Input
                    id={id}
                    value={businessNo}
                    onChange={(event) => setBusinessNo(event.target.value)}
                  />
                )}
              </Field>
              <Field
                label={format(m.emailLabel)}
                hint={format(system ? m.emailSystemHint : m.emailEditHint)}
              >
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    autoComplete="off"
                    value={email}
                    disabled={system}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                )}
              </Field>
              <Field label={format(m.userTypeLabel)}>
                {(id) => (
                  <Select value={userTypeId} onValueChange={setUserTypeId}>
                    <SelectTrigger id={id} xstyle={styles.fullField}>
                      <SelectValue placeholder={format(m.selectUserType)} />
                    </SelectTrigger>
                    <SelectContent>
                      {userTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </form>
          </FormDialog>

          <ConfirmDialog
            open={confirmingDisable}
            title={format(m.confirmDisableTitle)}
            description={format(m.confirmDisableBody)}
            confirmLabel={format(m.disable)}
            cancelLabel={format(m.cancel)}
            pending={setStatus.isPending}
            onConfirm={() => setStatus.mutate('disabled')}
            onCancel={() => setConfirmingDisable(false)}
          />

          <ConfirmDialog
            open={confirmingDelete}
            title={format(m.confirmUserDeleteTitle)}
            description={format(m.confirmUserDeleteBody)}
            confirmLabel={format(m.deleteAction)}
            cancelLabel={format(m.cancel)}
            pending={remove.isPending}
            onConfirm={() => remove.mutate(undefined)}
            onCancel={() => setConfirmingDelete(false)}
          />
        </>
      )}
    </div>
  )
}
