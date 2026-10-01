import { assertNever, useLocale } from '@qualy/web-i18n'
import {
  useApiMutation,
  isRecordId,
  LoadFailure,
  PageLink,
  SubjectAbsence,
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageNavigate,
  usePageRouteParams,
} from '@qualy/web-runtime'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ArrowLeftIcon, EllipsisIcon } from 'lucide-react'

import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { ConfirmDialog, Feedback, Field, FormDialog, useSettledCheck } from '@qualy/ui/admin'
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

import { rosterSearch } from './users/roster-address.ts'
import { authApi } from '../api.ts'
import { UserMoveDialog } from './UserMoveDialog.tsx'
import { emailShaped, refusedField, type PersonField } from './users/field-refusals.ts'
import { needsReauthentication, useReauthentication } from '../account/Reauthentication.tsx'
import { instantWords } from '../when.ts'
import { PersonFacts, type PersonFact } from './person-facts.tsx'
import * as m from '#messages'

// Who the open person is, above every section of their record.
//
// The user-detail shell renders this without knowing what a person is; this
// reads the person from the route it is mounted at, the same way the pages
// beside it do. It carries the acts that concern the person as a whole -
// their name, address and kind, whether they may sign in at all, whether
// they stay on the books - and nothing that belongs to one section.
//
// It is also who says the person is not there: an address naming nobody, a
// person deleted or beyond the reader, a first reading that failed. The
// shell then folds the record's sections away and shows what this hands it
// in their place, with the way back to the roster.

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
  // what is true of them at a glance: on a phone, the row under the portrait
  // and the name, the whole width
  factsSeat: {
    minWidth: 0,
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
    gridRow: { default: null, [breakpoints.phone]: 2 },
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
  // the room the record's pages would have had, for the state in their place
  absent: { display: 'flex', minWidth: 0, minHeight: 0, flexGrow: 1, flexDirection: 'column' },
})

export default function UserDetailHeader() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(authApi)

  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const locale = useLocale()
  const businessNoWord = useTerm(authTerms.businessNumber)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDisable, setConfirmingDisable] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [moving, setMoving] = useState(false)
  // a value somebody else already holds, said under the field it was typed in
  const [taken, setTaken] = useState<{ field: PersonField; said: string } | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [businessNo, setBusinessNo] = useState('')
  const [email, setEmail] = useState('')
  const [userTypeId, setUserTypeId] = useState('')
  const navigate = usePageNavigate()

  const describe = useLoadFailure()
  // an address that cannot name anybody is known to name nobody without asking
  const addressable = isRecordId(userId)
  const user = useQuery({
    ...query.identity.getUser.queryOptions({ params: { userId } }),
    enabled: addressable,
  })
  // not there and not the reader's are one answer on purpose
  const gone = {
    missing: ['USER_NOT_FOUND'],
    copy: { missing: { title: m.person_goneTitle(), description: m.person_gone() } },
  }
  const absent = addressable ? describe.subject(user, gone) : describe.missing(gone)
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

  // one's own address and number move only after the session shows it is
  // its owner's, from this screen as from one's own page
  const reauthentication = useReauthentication(undefined)

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.identity.key() })

  const saveProfile = useApiMutation({
    mutationFn: () =>
      api.identity.updateUser({
        params: { userId },
        payload: {
          version: record?.version ?? 1,
          displayName,
          userTypeId,
          // emptied means taken away; the recovery account's address and
          // number are not the form's to send at all, and neither are those
          // of somebody whose account is not this reader's
          ...(system || !accountManageable
            ? {}
            : {
                businessNo: businessNo.trim() === '' ? undefined : businessNo.trim(),
                email: email.trim() === '' ? null : email.trim(),
              }),
        },
      }),
    onMutate: () => {
      setFeedback(null)
      setSaved(false)
      setTaken(null)
    },
    onError: (error) => {
      let failure: string
      switch (error._tag) {
        case 'AUTH_DEMO_ACCOUNT_LOCKED':
          failure = m.error_demoAccountLocked()
          break
        case 'AUTH_REAUTHENTICATION_REQUIRED':
          failure = m.error_reauthenticationRequired()
          break
        case 'GRANT_INCOMPATIBLE':
          failure = m.error_grantIncompatible({ grantCount: error.grantCount })
          break
        case 'LAST_ADMINISTRATOR':
          failure = m.error_lastAdministrator()
          break
        case 'SYSTEM_ACCOUNT_PROTECTED':
          failure = m.error_systemAccountProtected()
          break
        case 'USER_CONFLICT':
          failure = m.error_userConflict()
          break
        case 'USER_EMAIL_CONFLICT':
          failure = m.error_userEmailConflict()
          break
        case 'USER_PLACEMENT_NOT_FOUND':
          failure = m.error_userPlacementNotFound()
          break
        case 'USER_TYPE_DISABLED':
          failure = m.error_userTypeDisabled()
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
      const field = refusedField(error)
      if (needsReauthentication(error)) reauthentication.ask(() => saveProfile.mutate(undefined))
      else if (field === undefined) setFeedback(failure)
      else setTaken({ field, said: failure })
    },
    onSuccess: async () => {
      setEditing(false)
      setSaved(true)
      await refresh()
    },
  })
  const setStatus = useApiMutation({
    mutationFn: (status: 'active' | 'disabled') =>
      api.identity.setUserStatus({
        params: { userId },
        payload: { status, version: record?.version ?? 1 },
      }),
    onMutate: () => {
      setFeedback(null)
      setSaved(false)
      setTaken(null)
    },
    onError: (error) => {
      switch (error._tag) {
        case 'LAST_ADMINISTRATOR':
          setFeedback(m.error_lastAdministrator())
          return
        case 'SYSTEM_ACCOUNT_PROTECTED':
          setFeedback(m.error_systemAccountProtected())
          return
        case 'USER_VERSION_CONFLICT':
          setFeedback(m.error_userVersionConflict())
          return
        default:
          assertNever(error)
      }
    },
    onSuccess: async () => {
      setConfirmingDisable(false)
      setSaved(true)
      await refresh()
    },
  })
  // Final: there is no record left to come back to, so the way out is the
  // roster the person was reached from.
  const remove = useApiMutation({
    mutationFn: () =>
      api.identity.deleteUser({
        params: { userId },
        query: { version: String(record?.version ?? 1) },
      }),
    onMutate: () => {
      setFeedback(null)
      setSaved(false)
      setTaken(null)
    },
    onError: (error) => {
      switch (error._tag) {
        case 'LAST_ADMINISTRATOR':
          setFeedback(m.error_lastAdministrator())
          return
        case 'SYSTEM_ACCOUNT_PROTECTED':
          setFeedback(m.error_systemAccountProtected())
          return
        case 'USER_VERSION_CONFLICT':
          setFeedback(m.error_userVersionConflict())
          return
        default:
          assertNever(error)
      }
    },
    onSuccess: () => {
      setConfirmingDelete(false)
      // Away to the roster, which is read again; what was read about the
      // person is not. Read again while the page is still leaving, it
      // answered "not found" and the page flashed its absence on the way out.
      navigate('auth/users', { search: rosterSearch(), replace: true })
      void queryClient.invalidateQueries({
        queryKey: query.identity.key(),
        predicate: (entry) => !JSON.stringify(entry.queryKey).includes(userId),
      })
    },
  })

  const manageable = record?.manageable ?? false
  // their ways in, the names a door finds them by, their kind, whether they
  // are in service, where they stand: a reader who may edit the record may
  // still not be one who may change these
  const accountManageable = user.data?.accountManageable ?? false
  // the platform's own account: where it stands and what it signs in with
  // are provisioned, so the form does not offer them
  const system = user.data?.placement.mode === 'tenant-root'
  const userTypes = options.data?.userTypes ?? []
  // what the form was refused is said in the form, and goes with it: the
  // band behind the dialog is under the overlay while it is up
  const stopEditing = () => {
    setEditing(false)
    setFeedback(null)
    setTaken(null)
  }
  const shape = useSettledCheck(email, (next) =>
    emailShaped(next) ? null : m.person_emailInvalid(),
  )
  // an address being replaced, which undoes what the old one had proven
  const replacingEmail =
    record?.email !== undefined &&
    record.email !== null &&
    email.trim() !== '' &&
    email.trim().toLowerCase() !== record.email

  // The same line the person reads over their own account, with what an
  // administrator looks for first in any section: whether the address was
  // proven, and whether they come in at all. Their roles are a section of
  // their own, named there; a count of them said nothing.
  const path = user.data?.orgPath ?? []
  const lastSignInAt = user.data?.lastSignInAt ?? null
  const facts: PersonFact[] =
    record === undefined
      ? []
      : [
          // the platform's own account has no number to give and nobody to
          // give it one, so a missing one is not a gap to point at
          ...(record.businessNo !== null
            ? [{ key: 'business-no', label: businessNoWord, value: record.businessNo }]
            : system
              ? []
              : [
                  {
                    key: 'business-no',
                    label: businessNoWord,
                    value: m.person_fieldUnset(),
                    warn: true,
                  },
                ]),
          {
            key: 'unit',
            label: m.person_placement(),
            // the unit itself, the whole way down to it on hover
            value: path.at(-1)?.name ?? '—',
            title: path.map((step) => step.name).join(' / '),
          },
          record.email === null
            ? { key: 'email', label: m.users_email(), value: m.person_fieldUnset(), warn: true }
            : {
                key: 'email',
                label: m.users_email(),
                value: record.email,
                ...(record.emailVerifiedAt === null ? { aside: m.users_emailUnverified() } : {}),
              },
          {
            key: 'last-sign-in',
            label: m.users_lastSignIn(),
            value:
              lastSignInAt === null ? m.person_neverUsed() : instantWords(locale, lastSignInAt),
          },
        ]

  if (absent !== null) {
    return (
      <SubjectAbsence>
        <div data-testid="user-detail-absent" {...stylex.props(styles.absent)}>
          <LoadFailure
            failure={absent}
            onRetry={() => void user.refetch()}
            retrying={user.isFetching}
            back={{ page: 'auth/users', label: m.users_back(), search: rosterSearch() }}
          />
        </div>
      </SubjectAbsence>
    )
  }

  return (
    <div data-testid="user-detail-header" {...stylex.props(styles.band)}>
      <PageLink
        page="auth/users"
        // back to the roster as it was left: its unit, its filter, its page
        search={rosterSearch()}
        className={stylex.props(styles.backLink).className}
      >
        <ArrowLeftIcon className={stylex.props(styles.backGlyph).className} aria-hidden />
        {m.users_back()}
      </PageLink>

      {!record ? (
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
                  {(record.status === 'disabled' ? m.badge_disabled : m.users_statusActive)()}
                </Status>
              </div>
              <div {...stylex.props(styles.factsSeat)}>
                <PersonFacts facts={facts} wrap />
              </div>
            </div>
            {manageable && (
              <div {...stylex.props(styles.actions)}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // what the band last said was about something else
                    setFeedback(null)
                    setEditing(true)
                  }}
                >
                  {m.person_editProfile()}
                </Button>
                {/* the same move the organization section offers, opened here:
                      going to that section first did nothing visible when the
                      reader was already on it */}
                {accountManageable && (
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="band-move-open"
                    onClick={() => {
                      setFeedback(null)
                      setMoving(true)
                    }}
                  >
                    {m.action_transfer()}
                  </Button>
                )}
                {accountManageable && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon-sm" aria-label={m.action_more()}>
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
                        {(record.status === 'active' ? m.action_disable : m.action_enable)()}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className={stylex.props(styles.danger).className}
                        disabled={remove.isPending}
                        onSelect={() => setConfirmingDelete(true)}
                      >
                        {m.action_deleteUser()}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
          </div>
          {!editing && (feedback !== null || saved) && (
            <div {...stylex.props(styles.feedbackSeat)}>
              <Feedback message={feedback} />
              {saved && feedback === null && (
                <Feedback message={m.feedback_saved()} tone="success" />
              )}
            </div>
          )}

          <FormDialog
            open={editing}
            title={m.person_editProfile()}
            onClose={stopEditing}
            footer={
              <>
                <Button variant="outline" onClick={stopEditing}>
                  {m.action_cancel()}
                </Button>
                <Button
                  type="submit"
                  form="edit-profile"
                  disabled={
                    saveProfile.isPending || displayName.trim() === '' || !emailShaped(email)
                  }
                >
                  {m.action_save()}
                </Button>
              </>
            }
          >
            <form
              id="edit-profile"
              {...stylex.props(styles.form)}
              onSubmit={(event) => {
                event.preventDefault()
                if (emailShaped(email)) saveProfile.mutate(undefined)
              }}
            >
              <Feedback message={feedback} />
              <Field label={m.field_name()} required>
                {(id, control) => (
                  <Input
                    id={id}
                    {...control}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                )}
              </Field>
              <Field
                label={businessNoWord}
                {...(system || !accountManageable
                  ? {}
                  : { hint: m.person_businessNoPurpose({ businessNo: businessNoWord }) })}
                error={taken?.field === 'businessNo' ? taken.said : undefined}
              >
                {(id, control) => (
                  <Input
                    id={id}
                    {...control}
                    value={businessNo}
                    disabled={system || !accountManageable}
                    onChange={(event) => {
                      setBusinessNo(event.target.value)
                      if (taken?.field === 'businessNo') setTaken(null)
                    }}
                  />
                )}
              </Field>
              <Field
                label={m.users_email()}
                hint={(system
                  ? m.users_emailSystemHint
                  : !accountManageable
                    ? m.users_accountBeyondReachHint
                    : replacingEmail
                      ? m.person_emailChangeConsequence
                      : m.person_emailPurpose)()}
                error={taken?.field === 'email' ? taken.said : (shape.error ?? undefined)}
              >
                {(id, control) => (
                  <Input
                    id={id}
                    {...control}
                    type="email"
                    autoComplete="off"
                    value={email}
                    disabled={system || !accountManageable}
                    onBlur={shape.onBlur}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      if (taken?.field === 'email') setTaken(null)
                    }}
                  />
                )}
              </Field>
              <Field label={m.field_userType()} required>
                {(id, control) => (
                  <Select
                    value={userTypeId}
                    onValueChange={setUserTypeId}
                    disabled={!accountManageable}
                  >
                    <SelectTrigger id={id} {...control} xstyle={styles.fullField}>
                      <SelectValue placeholder={m.field_selectUserType()} />
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
            title={m.confirm_disableTitle()}
            description={m.confirm_disableBody()}
            confirmLabel={m.action_disable()}
            cancelLabel={m.action_cancel()}
            pending={setStatus.isPending}
            onConfirm={() => setStatus.mutate('disabled')}
            onCancel={() => setConfirmingDisable(false)}
          />

          <ConfirmDialog
            open={confirmingDelete}
            title={m.confirm_userDeleteTitle()}
            description={m.confirm_userDeleteBody()}
            confirmLabel={m.action_deleteUser()}
            cancelLabel={m.action_cancel()}
            pending={remove.isPending}
            onConfirm={() => remove.mutate(undefined)}
            onCancel={() => setConfirmingDelete(false)}
          />

          {accountManageable && (
            <UserMoveDialog
              userId={userId}
              open={moving}
              onClose={() => setMoving(false)}
              onStart={() => {
                setFeedback(null)
                setSaved(false)
              }}
              onDone={(outcome) => {
                if (outcome.moved) setSaved(true)
                else setFeedback(outcome.said)
              }}
            />
          )}
        </>
      )}
      {reauthentication.dialog}
    </div>
  )
}
