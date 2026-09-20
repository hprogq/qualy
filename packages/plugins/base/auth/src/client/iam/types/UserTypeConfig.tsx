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
  PageLink,
  usePageHref,
  usePageNavigate,
} from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
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
import { iamMessages as m } from '../../i18n.ts'
import { authApi } from '../../api.ts'
import { useUserTypeFacts } from './facts.ts'

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
  const { format, formatError } = useI18n()
  const listJoin = useList()
  const facts = useUserTypeFacts()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [renaming, setRenaming] = useState(false)
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
    onSuccess: async () => {
      setRenaming(false)
      await refresh()
    },
  })
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
      : format(fixed ? m.placementTenantRoot : m.placementAnywhere)
  const active = userType.status === 'active'

  return (
    <Screen
      back={
        <BandBack as={PageLink} page="auth/user-types">
          {format(m.backToUserTypes)}
        </BandBack>
      }
      title={userType.name}
      titleAside={
        <>
          {userType.isSystem && <Tag>{format(m.systemBadge)}</Tag>}
          <Tag>{format(active ? m.typeEnabled : m.statusDisabled)}</Tag>
        </>
      }
      {...(userType.description !== null && userType.description !== ''
        ? { description: userType.description }
        : {})}
      actions={
        canManage && (
          <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
            {format(m.rename)}
          </Button>
        )
      }
    >
      <Feedback message={feedback} />
      {saved && feedback === null && <Feedback message={format(m.saved)} tone="success" />}

      <FactStrip
        testId="type-facts"
        columns={5}
        items={[
          {
            label: format(m.columnUsers),
            value: format(m.userCount, { count: userType.userCount }),
          },
          { label: format(m.placementLegend), value: belongsWord },
          {
            label: format(m.signInLabel),
            value:
              admitting === undefined ? (
                format(m.unknownWord)
              ) : admitting.length === 0 ? (
                <Status tone="warn">{format(m.noneWord)}</Status>
              ) : (
                listJoin(admitting.map((entrance) => entrance.name))
              ),
          },
          {
            label: format(m.openRolesLabel),
            value:
              openRoles === undefined
                ? format(m.unknownWord)
                : format(m.roleCount, { count: openRoles.length }),
          },
          {
            label: format(m.columnStatus),
            value: (
              <Status tone={active ? 'plain' : 'bad'}>
                {format(active ? m.typeEnabled : m.statusDisabled)}
              </Status>
            ),
          },
        ]}
      />

      <div {...stylex.props(styles.frame)}>
        <div {...stylex.props(styles.column)}>
          <Card data-testid="placement-panel" data-mode={mode} data-dirty={dirty}>
            <CardHead title={format(m.placementLegend)}>
              {!fixed &&
                (editable ? (
                  <Segmented
                    label={format(m.placementLegend)}
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'unrestricted', label: format(m.placementAnywhere) },
                      { value: 'allow-list', label: format(m.placementListed) },
                    ]}
                  />
                ) : (
                  <span {...stylex.props(styles.modeWord)}>
                    {format(mode === 'unrestricted' ? m.placementAnywhere : m.placementListed)}
                  </span>
                ))}
            </CardHead>
            {fixed ? (
              <p {...stylex.props(styles.fixed)}>{format(m.placementTenantRoot)}</p>
            ) : (
              <AsyncSection
                pending={facts.catalog.isPending}
                error={facts.catalog.isError ? formatError(facts.catalog.error) : null}
                loadingLabel={format(commonMessages.loading)}
                retryLabel={format(commonMessages.retry)}
                onRetry={() => void facts.catalog.refetch()}
              >
                {mode === 'allow-list' &&
                  (facts.orgTypes.length === 0 ? (
                    <CardEmpty>{format(m.noOptions)}</CardEmpty>
                  ) : (
                    <TickGrid columns={3} label={format(m.allowedOrgTypesLegend)}>
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
                <CardHint top={mode !== 'allow-list'}>{format(m.placementHint)}</CardHint>
              </AsyncSection>
            )}
            {editable && (
              <CardFoot inset>
                {dirty && <UnsavedMark>{format(m.unsaved)}</UnsavedMark>}
                <Spacer />
                <Button variant="ghost" size="sm" disabled={!dirty} onClick={revert}>
                  {format(m.discard)}
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
                  onClick={() => savePlacement.mutate(undefined as never)}
                >
                  {format(m.save)}
                </Button>
              </CardFoot>
            )}
          </Card>

          <Card data-testid="type-lifecycle" data-populated={populated}>
            <CardHead title={format(m.lifecycleLabel)} />
            <div {...stylex.props(styles.lifecycle)}>
              <span {...stylex.props(styles.reason)}>
                {[
                  ...(populated ? [format(m.blockerInUse, { count: userType.userCount })] : []),
                  ...(userType.isSystem ? [format(m.blockerSystem)] : []),
                  ...(!populated && !userType.isSystem ? [format(m.blockerClear)] : []),
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
                    {format(active ? m.disable : m.enable)}
                  </Button>
                  {!userType.isSystem && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={populated}
                      onClick={() => setConfirmingDelete(true)}
                    >
                      {format(m.delete)}
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
              <CardHead title={format(m.signInLabel)}>
                {entrancesHref !== undefined && (
                  <PageLink
                    page="auth/login-methods"
                    className={stylex.props(styles.link).className}
                  >
                    <ArrowUpRightIcon aria-hidden {...stylex.props(styles.linkIcon)} />
                    {format(m.signInSettings)}
                  </PageLink>
                )}
              </CardHead>
              {admitting === undefined || admitting.length === 0 ? (
                <CardEmpty>{format(m.signInNone)}</CardEmpty>
              ) : (
                <DefList>
                  {admitting.map((entrance) => (
                    <DefLine key={entrance.id} label={entrance.name}>
                      {entrance.audience.mode === 'unrestricted'
                        ? format(m.audienceEveryone)
                        : format(m.audienceSummary, {
                            count: entrance.audience.userTypeIds.length,
                          })}
                    </DefLine>
                  ))}
                </DefList>
              )}
              <CardHint>{format(m.signInOwnerHint)}</CardHint>
            </Card>
          )}

          {openRoles !== undefined && (
            <Card data-testid="type-roles" data-count={openRoles.length}>
              <CardHead title={format(m.openRolesLabel)} />
              {openRoles.length === 0 ? (
                <CardEmpty>{format(m.openRolesNone)}</CardEmpty>
              ) : (
                <DefList>
                  {openRoles.map((role) => (
                    <DefLine key={role.id} label={role.name}>
                      {format(role.kind === 'tenant' ? m.roleKindTenant : m.roleKindOrg)}
                    </DefLine>
                  ))}
                </DefList>
              )}
              <CardHint>{format(m.openRolesOwnerHint)}</CardHint>
            </Card>
          )}
        </div>
      </div>

      <FormDialog
        open={renaming}
        title={format(m.rename)}
        onClose={() => setRenaming(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              {format(m.cancel)}
            </Button>
            <Button
              type="submit"
              form="rename-user-type"
              disabled={saveProfile.isPending || name.trim() === ''}
            >
              {format(m.save)}
            </Button>
          </>
        }
      >
        <form
          id="rename-user-type"
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault()
            saveProfile.mutate(undefined as never)
          }}
        >
          <Field label={format(m.nameLabel)}>
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label={format(m.descriptionLabel)}>
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
        title={format(m.confirmDeleteTitle)}
        description={format(m.confirmDeleteBody)}
        confirmLabel={format(m.delete)}
        cancelLabel={format(m.cancel)}
        pending={remove.isPending}
        onConfirm={() => remove.mutate(undefined as never)}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Screen>
  )
}
