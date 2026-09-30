import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useEffect, useState } from 'react'
import type { Effect } from 'effect'
import type { ApiResult } from '@qualy/web-runtime/api'
import {
  useApi,
  useRunApi,
  useApiQuery,
  useLoadFailure,
  PageLink,
  usePageHref,
  usePageNavigate,
} from '@qualy/web-runtime'
import { getApiErrorCode, useI18n, useList } from '@qualy/web-i18n'

import { AsyncSection, ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import {
  BandBack,
  Card,
  CardEmpty,
  CardFoot,
  CardHead,
  CardHint,
  DefLine,
  DefList,
  FactStrip,
  Screen,
  Segmented,
  Spacer,
  Status,
  Tag,
  Tick,
  TickGrid,
  UnsavedMark,
} from '@qualy/ui/screen'
import { ArrowUpRightIcon } from 'lucide-react'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'

import { authApi } from '../../api.ts'
import { useUserTypeFacts } from './facts.ts'
import { TypeMembers } from './TypeMembers.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One user type's own page.
//
// The left column is what this page may change: where the kind of person may
// belong, and whether the type stays in service. The right column is what it
// may only read - who lets the type in, which roles it may carry - each with
// the way to the page that owns it. A type confers no authority, so nothing
// here is a permission.

export type UserTypeRow = ApiResult<
  typeof authApi,
  'identity',
  'listUserTypes'
>['userTypes'][number]
type Mode = 'unrestricted' | 'allow-list'

const styles = stylex.create({
  frame: {
    display: 'grid',
    alignItems: 'start',
    gap: 14,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [breakpoints.desktop]: 'minmax(0, 1fr) 380px',
    },
  },
  column: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 14 },
  fixed: { paddingInline: 16, paddingBlock: 12, fontSize: 13, lineHeight: 1.55 },
  modeWord: { fontSize: 12.5, color: tokens.mutedForeground },
  lifecycle: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 12,
    flexWrap: 'wrap',
  },
  reason: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '14rem',
    fontSize: 12,
    lineHeight: 1.55,
    color: tokens.mutedForeground,
    textWrap: 'pretty',
  },
  buttons: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8 },
  link: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingInline: 10,
    borderRadius: 8,
    fontSize: 12,
    color: tokens.surfaceMutedForeground,
    textDecoration: 'none',
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
  },
  linkIcon: { width: 13, height: 13 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
})

const modeOf = (userType: UserTypeRow): Mode =>
  userType.placementPolicy.mode === 'unrestricted' ? 'unrestricted' : 'allow-list'
const storedOf = (userType: UserTypeRow): string[] =>
  userType.placementPolicy.mode === 'allow-list' ? [...userType.placementPolicy.orgTypeIds] : []

export function UserTypeConfig({
  userType,
  canManage,
}: {
  userType: UserTypeRow
  canManage: boolean
}) {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const navigate = usePageNavigate()
  // the way to the entrances is offered only to a reader who may go there
  const entrancesHref = usePageHref('auth/login-methods')
  const { formatError } = useI18n()
  const describe = useLoadFailure()
  const listJoin = useList()
  const facts = useUserTypeFacts()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // what a rename was refused for is said in its dialog, not behind it: a
  // name another type has under the name, anything else above the fields
  const [renameRefusal, setRenameRefusal] = useState<{
    readonly taken: boolean
    readonly said: string
  } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [name, setName] = useState(userType.name)
  const [description, setDescription] = useState(userType.description ?? '')
  const [mode, setMode] = useState<Mode>(modeOf(userType))
  const [orgTypeIds, setOrgTypeIds] = useState<string[]>(storedOf(userType))

  // a save brings back new server state, and the draft re-seeds from it
  useEffect(() => {
    setName(userType.name)
    setDescription(userType.description ?? '')
    setMode(modeOf(userType))
    setOrgTypeIds(storedOf(userType))
  }, [userType])

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.identity.key() })
  // the one crossing from an effect to a promise on this screen: TanStack
  // needs a promise, and doing it here keeps every call site an effect
  const run = <Variables,>(call: (input: Variables) => Effect.Effect<unknown, unknown>) => ({
    mutationFn: (input: Variables) => runApi(call(input)),
    onMutate: () => {
      setFeedback(null)
      setSaved(false)
    },
    onSuccess: async () => {
      setSaved(true)
      await refresh()
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const saveProfile = useMutation({
    ...run(() =>
      api.identity.updateUserType({
        params: { userTypeId: userType.id },
        payload: {
          // the version this editor read: a save that cannot say what it saw
          // is a save that silently overwrites whoever went second
          version: userType.version,
          name,
          description: description.trim() === '' ? null : description,
        },
      }),
    ),
    onMutate: () => {
      setSaved(false)
      setRenameRefusal(null)
    },
    onSuccess: async () => {
      setRenaming(false)
      await refresh()
    },
    onError: (error: unknown) =>
      setRenameRefusal({
        taken: getApiErrorCode(error) === 'USER_TYPE_CONFLICT',
        said: formatError(error),
      }),
  })
  const closeRename = () => {
    setRenaming(false)
    setRenameRefusal(null)
  }
  const savePlacement = useMutation(
    run(() =>
      api.identity.setPlacementPolicy({
        params: { userTypeId: userType.id },
        payload: {
          version: userType.version,
          policy:
            mode === 'unrestricted' ? { mode: 'unrestricted' } : { mode: 'allow-list', orgTypeIds },
        },
      }),
    ),
  )
  const setStatus = useMutation(
    run((status: 'active' | 'disabled') =>
      api.identity.setUserTypeStatus({
        params: { userTypeId: userType.id },
        payload: { status, version: userType.version },
      }),
    ),
  )
  const remove = useMutation({
    ...run(() =>
      api.identity.deleteUserType({
        params: { userTypeId: userType.id },
        query: { version: String(userType.version) },
      }),
    ),
    onSuccess: async () => {
      setConfirmingDelete(false)
      // the page is about a type that is gone; the list is where it was
      navigate('auth/user-types')
      await refresh()
    },
  })

  const fixed = userType.placementPolicy.mode === 'tenant-root'
  const editable = canManage && !userType.isSystem && !fixed
  const populated = userType.userCount > 0
  const stored = storedOf(userType)
  const dirty =
    mode !== modeOf(userType) || [...orgTypeIds].sort().join(',') !== [...stored].sort().join(',')
  const revert = () => {
    setMode(modeOf(userType))
    setOrgTypeIds(stored)
  }

  const entrances = facts.entrances(userType)
  const admitting = entrances?.filter((entrance) => entrance.admits)
  const openRoles = facts.openRoles(userType)
  const belongsWord =
    userType.placementPolicy.mode === 'allow-list'
      ? listJoin(facts.allowedKinds(userType))
      : (fixed ? m.field_placementTenantRoot : m.userTypes_placementAnywhere)()
  const active = userType.status === 'active'

  return (
    <Screen
      back={
        <BandBack as={PageLink} page="auth/user-types">
          {m.userTypes_back()}
        </BandBack>
      }
      title={userType.name}
      titleAside={
        <>
          {userType.isSystem && <Tag>{m.badge_system()}</Tag>}
          <Tag>{(active ? m.state_enabled : m.state_disabled)()}</Tag>
        </>
      }
      {...(userType.description !== null && userType.description !== ''
        ? { description: userType.description }
        : {})}
      actions={
        canManage && (
          <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
            {m.action_rename()}
          </Button>
        )
      }
    >
      <Feedback message={feedback} />
      {saved && feedback === null && <Feedback message={m.feedback_saved()} tone="success" />}

      <FactStrip
        testId="type-facts"
        columns={5}
        items={[
          {
            label: m.userTypes_columnUsers(),
            value: m.userTypes_userCount({ count: userType.userCount }),
          },
          { label: m.userTypes_placementLegend(), value: belongsWord },
          {
            label: m.userTypes_signIn(),
            value:
              admitting === undefined ? (
                m.word_unknown()
              ) : admitting.length === 0 ? (
                <Status tone="warn">{m.word_none()}</Status>
              ) : (
                listJoin(admitting.map((entrance) => entrance.name))
              ),
          },
          {
            label: m.userTypes_openRoles(),
            value:
              openRoles === undefined
                ? m.word_unknown()
                : m.userTypes_roleCount({ count: openRoles.length }),
          },
          {
            label: m.users_columnStatus(),
            value: (
              <Status tone={active ? 'plain' : 'bad'}>
                {(active ? m.state_enabled : m.state_disabled)()}
              </Status>
            ),
          },
        ]}
      />

      <div {...stylex.props(styles.frame)}>
        <div {...stylex.props(styles.column)}>
          <Card data-testid="placement-panel" data-mode={mode} data-dirty={dirty}>
            <CardHead title={m.userTypes_placementLegend()}>
              {!fixed &&
                (editable ? (
                  <Segmented
                    label={m.userTypes_placementLegend()}
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'unrestricted', label: m.userTypes_placementAnywhere() },
                      { value: 'allow-list', label: m.userTypes_placementListed() },
                    ]}
                  />
                ) : (
                  <span {...stylex.props(styles.modeWord)}>
                    {(mode === 'unrestricted'
                      ? m.userTypes_placementAnywhere
                      : m.userTypes_placementListed)()}
                  </span>
                ))}
            </CardHead>
            {fixed ? (
              <p {...stylex.props(styles.fixed)}>{m.field_placementTenantRoot()}</p>
            ) : (
              <AsyncSection
                pending={facts.catalog.isPending}
                error={facts.catalog.isError ? describe.of(facts.catalog.error) : null}
                retrying={facts.catalog.isFetching}
                loadingLabel={commonMessages.state_loading()}
                retryLabel={commonMessages.action_retry()}
                onRetry={() => void facts.catalog.refetch()}
              >
                {mode === 'allow-list' &&
                  (facts.orgTypes.length === 0 ? (
                    <CardEmpty>{m.field_noOptions()}</CardEmpty>
                  ) : (
                    <TickGrid columns={3} label={m.field_allowedOrgTypes()}>
                      {facts.orgTypes.map((orgType) => (
                        <Tick
                          key={orgType.id}
                          label={orgType.name}
                          checked={orgTypeIds.includes(orgType.id)}
                          disabled={!editable}
                          onChange={(next) =>
                            setOrgTypeIds((current) =>
                              next
                                ? [...current, orgType.id]
                                : current.filter((id) => id !== orgType.id),
                            )
                          }
                        />
                      ))}
                    </TickGrid>
                  ))}
                <CardHint top={mode !== 'allow-list'}>{m.field_placementHint()}</CardHint>
              </AsyncSection>
            )}
            {editable && (
              <CardFoot inset>
                {dirty && <UnsavedMark>{m.state_unsaved()}</UnsavedMark>}
                <Spacer />
                <Button variant="ghost" size="sm" disabled={!dirty} onClick={revert}>
                  {m.action_discard()}
                </Button>
                <Button
                  size="sm"
                  // an allow-list naming nothing is not a policy, and the api
                  // says so; the button says so first
                  disabled={
                    !dirty ||
                    savePlacement.isPending ||
                    (mode === 'allow-list' && orgTypeIds.length === 0)
                  }
                  onClick={() => savePlacement.mutate(undefined)}
                >
                  {m.action_save()}
                </Button>
              </CardFoot>
            )}
          </Card>

          <TypeMembers userTypeId={userType.id} />

          <Card data-testid="type-lifecycle" data-populated={populated}>
            <CardHead title={m.userTypes_lifecycle()} />
            <div {...stylex.props(styles.lifecycle)}>
              <span {...stylex.props(styles.reason)}>
                {[
                  ...(populated ? [m.userTypes_blockerInUse({ count: userType.userCount })] : []),
                  ...(userType.isSystem ? [m.userTypes_blockerSystem()] : []),
                  ...(!populated && !userType.isSystem ? [m.userTypes_blockerClear()] : []),
                ].join(' ')}
              </span>
              {canManage && (
                <span {...stylex.props(styles.buttons)}>
                  <Button
                    variant="outline"
                    size="sm"
                    // a populated type cannot be disabled at all: the api
                    // refuses it, so offering the button would only produce
                    // an error
                    disabled={setStatus.isPending || (active && populated)}
                    onClick={() => setStatus.mutate(active ? 'disabled' : 'active')}
                  >
                    {(active ? m.action_disable : m.action_enable)()}
                  </Button>
                  {!userType.isSystem && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={populated}
                      onClick={() => setConfirmingDelete(true)}
                    >
                      {m.action_delete()}
                    </Button>
                  )}
                </span>
              )}
            </div>
          </Card>
        </div>

        <div {...stylex.props(styles.column)}>
          {entrances !== undefined && (
            <Card data-testid="type-entrances" data-count={admitting?.length ?? 0}>
              <CardHead title={m.userTypes_signIn()}>
                {entrancesHref !== undefined && (
                  <PageLink
                    page="auth/login-methods"
                    className={stylex.props(styles.link).className}
                  >
                    <ArrowUpRightIcon aria-hidden {...stylex.props(styles.linkIcon)} />
                    {m.userTypes_signInSettings()}
                  </PageLink>
                )}
              </CardHead>
              {admitting === undefined || admitting.length === 0 ? (
                <CardEmpty>{m.userTypes_signInNone()}</CardEmpty>
              ) : (
                <DefList>
                  {admitting.map((entrance) => (
                    <DefLine key={entrance.id} label={entrance.name}>
                      {entrance.audience.mode === 'unrestricted'
                        ? m.loginMethods_audienceEveryone()
                        : m.loginMethods_audienceSummary({
                            count: entrance.audience.userTypeIds.length,
                          })}
                    </DefLine>
                  ))}
                </DefList>
              )}
              <CardHint>{m.userTypes_signInOwnerHint()}</CardHint>
            </Card>
          )}

          {openRoles !== undefined && (
            <Card data-testid="type-roles" data-count={openRoles.length}>
              <CardHead title={m.userTypes_openRoles()} />
              {openRoles.length === 0 ? (
                <CardEmpty>{m.userTypes_openRolesNone()}</CardEmpty>
              ) : (
                <DefList>
                  {openRoles.map((role) => (
                    <DefLine key={role.id} label={role.name}>
                      {(role.kind === 'tenant'
                        ? m.userTypes_roleKindTenant
                        : m.userTypes_roleKindOrg)()}
                    </DefLine>
                  ))}
                </DefList>
              )}
              <CardHint>{m.userTypes_openRolesOwnerHint()}</CardHint>
            </Card>
          )}
        </div>
      </div>

      <FormDialog
        open={renaming}
        title={m.action_rename()}
        onClose={closeRename}
        footer={
          <>
            <Button variant="outline" onClick={closeRename}>
              {m.action_cancel()}
            </Button>
            <Button
              type="submit"
              form="rename-user-type"
              disabled={saveProfile.isPending || name.trim() === ''}
            >
              {m.action_save()}
            </Button>
          </>
        }
      >
        <Feedback message={renameRefusal?.taken === false ? renameRefusal.said : null} />
        <form
          id="rename-user-type"
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault()
            saveProfile.mutate(undefined)
          }}
        >
          <Field
            label={m.field_name()}
            required
            error={renameRefusal?.taken === true ? renameRefusal.said : null}
          >
            {(id, control) => (
              <Input
                id={id}
                {...control}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (renameRefusal?.taken === true) setRenameRefusal(null)
                }}
              />
            )}
          </Field>
          <Field label={m.field_description()}>
            {(id) => (
              <Input
                id={id}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
        </form>
      </FormDialog>

      <ConfirmDialog
        open={confirmingDelete}
        title={m.confirm_deleteTitle()}
        description={m.confirm_deleteBody()}
        confirmLabel={m.action_delete()}
        cancelLabel={m.action_cancel()}
        pending={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Screen>
  )
}
