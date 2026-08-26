import type { ApiResult } from '@qualy/web-runtime/api'
import type { Effect } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import {
  DefRow,
  EditorHead,
  Facts,
  ModeChoice,
  PickGrid,
  PickList,
  SaveBar,
  Segmented,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { rbacMessages as m } from './i18n.ts'
import { accessApi } from './api.ts'

// One role, read as four questions rather than one long form: what it may do,
// who may hold it, which offices it appoints, and whether it is in force.
//
// They are tabs because the api treats them as separate subresources and a
// reader arrives with one of the four in mind - not because the editor is too
// long. What stays outside the tabs is the summary strip: a role's kind, its
// status, how many people hold it and who it is open to are the facts a
// reader needs whichever tab they came for.
/** the row as the api answers it, not a copy that can drift from it */
export type RoleRow = ApiResult<typeof accessApi, 'access', 'listRoles'>['roles'][number]

const styles = stylex.create({
  editor: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 16,
  },
  // the summary strip: one quiet surface, not a card among cards
  factsStrip: {
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 30%, transparent)`,
    paddingInline: 16,
    paddingBlock: 12,
  },
  toolbar: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  search: {
    height: 32,
    width: 192,
  },
  quietNote: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  smallNote: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  permissionGrid: {
    display: 'grid',
    minWidth: 0,
    gap: 12,
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 1280px)': 'repeat(2, minmax(0, 1fr))',
    },
  },
  stack: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 16,
  },
  stackTight: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
  },
  anchorSection: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 16,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
})

type Tab = 'permissions' | 'eligibility' | 'appointment' | 'lifecycle'

export function RoleEditor({ role, canManage }: { role: RoleRow; canManage: boolean }) {
  const api = useApi(accessApi)
  const runApi = useRunApi()
  const orpc = useApiQuery(accessApi)
  const queryClient = useQueryClient()
  const { format, formatError, formatText } = useI18n()
  const [tab, setTab] = useState<Tab>('permissions')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // an active role's duties change live under every holder and every future
  // appointment, so that save states its blast radius before it lands
  const [confirmingPermissions, setConfirmingPermissions] = useState(false)
  const [search, setSearch] = useState('')
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
  const [permissions, setPermissions] = useState<string[]>([...role.permissions])
  const [holderMode, setHolderMode] = useState<'unrestricted' | 'allow-list'>(
    role.holderPolicy.mode,
  )
  const [anchorMode, setAnchorMode] = useState<'unrestricted' | 'allow-list'>(
    role.anchorPolicy?.mode ?? 'unrestricted',
  )
  const [userTypeIds, setUserTypeIds] = useState<string[]>(
    role.holderPolicy.mode === 'allow-list' ? [...role.holderPolicy.userTypeIds] : [],
  )
  const [orgTypeIds, setOrgTypeIds] = useState<string[]>(
    role.anchorPolicy?.mode === 'allow-list' ? [...role.anchorPolicy.orgTypeIds] : [],
  )

  const seed = () => {
    setName(role.name)
    setDescription(role.description ?? '')
    setPermissions([...role.permissions])
    setHolderMode(role.holderPolicy.mode)
    setAnchorMode(role.anchorPolicy?.mode ?? 'unrestricted')
    setUserTypeIds(
      role.holderPolicy.mode === 'allow-list' ? [...role.holderPolicy.userTypeIds] : [],
    )
    setOrgTypeIds(role.anchorPolicy?.mode === 'allow-list' ? [...role.anchorPolicy.orgTypeIds] : [])
  }
  // a different record is a different form, so the draft re-seeds when the
  // selection changes or when a save brings back new server state
  useEffect(() => {
    seed()
    setFeedback(null)
    setSearch('')
  }, [role])

  const catalog = useQuery(
    orpc.access.listPermissions.queryOptions({
      query: { target: role.kind === 'org' ? 'org-node' : 'tenant' },
    }),
  )
  const options = useQuery(orpc.access.getRoleOptions.queryOptions())
  // the canonical administrator role is fixed wherever changing it would
  // lock a tenant out of its own administration; it also appoints everything
  // by being what it is, so it has no appointment list to edit
  const locked = role.systemKey !== null
  // Who this office may appoint. Candidates are roles of the SAME kind
  // only - an org office held somewhere can never execute a tenant-wide
  // appointment, and the server refuses the edge - and the office must
  // itself carry the matching grant administration before it can appoint
  // anybody: an edge that waits for some other role of the holder's to make
  // it work is exactly what the model no longer allows.
  const allRoles = useQuery(orpc.access.listRoles.queryOptions({ query: {} }))
  const grantable = useQuery({
    ...orpc.access.getRoleGrantableRoles.queryOptions({ params: { roleId: role.id } }),
    enabled: !locked,
  })
  const [grantableIds, setGrantableIds] = useState<string[]>([])
  useEffect(() => {
    setGrantableIds([...(grantable.data?.roleIds ?? [])])
  }, [grantable.data])

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.access.key() })
  // the one crossing from an effect to a promise on this screen: TanStack
  // needs a promise, and doing it here keeps every call site an effect
  const run = <Variables,>(call: (input: Variables) => Effect.Effect<unknown, unknown>) => ({
    mutationFn: (input: Variables) => runApi(call(input)),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await refresh()
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const saveProfile = useMutation({
    ...run(() =>
      // the version this editor read: a save that cannot say what it saw is
      // a save that silently overwrites whoever went second
      api.access.updateRole({
        params: { roleId: role.id },
        payload: {
          version: role.version,
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
  const savePermissions = useMutation({
    ...run(() =>
      api.access.setRolePermissions({
        params: { roleId: role.id },
        payload: { version: role.version, codes: permissions },
      }),
    ),
    onSettled: () => setConfirmingPermissions(false),
  })
  const saveEligibility = useMutation(
    run(() =>
      api.access.setRoleEligibility({
        params: { roleId: role.id },
        payload: {
          version: role.version,
          holderPolicy:
            holderMode === 'unrestricted'
              ? { mode: 'unrestricted' as const }
              : { mode: 'allow-list' as const, userTypeIds },
          // a tenant role anchors to nothing, and the payload says so
          anchorPolicy:
            role.kind === 'org'
              ? anchorMode === 'unrestricted'
                ? { mode: 'unrestricted' as const }
                : { mode: 'allow-list' as const, orgTypeIds }
              : null,
        },
      }),
    ),
  )
  const saveGrantable = useMutation(
    run(() =>
      api.access.setRoleGrantableRoles({
        params: { roleId: role.id },
        payload: { version: role.version, roleIds: grantableIds },
      }),
    ),
  )
  const setAssignable = useMutation(
    run((assignable: boolean) =>
      api.access.updateRole({
        params: { roleId: role.id },
        payload: { version: role.version, assignable },
      }),
    ),
  )
  const setStatus = useMutation(
    run((status: 'active' | 'disabled') =>
      api.access.setRoleStatus({
        params: { roleId: role.id },
        payload: { version: role.version, status },
      }),
    ),
  )
  const remove = useMutation({
    ...run(() =>
      api.access.deleteRole({
        params: { roleId: role.id },
        query: { version: String(role.version) },
      }),
    ),
    onSuccess: async () => {
      setConfirmingDelete(false)
      await refresh()
    },
  })

  const editable = canManage && !locked
  const permissionsDirty =
    [...permissions].sort().join(',') !== [...role.permissions].sort().join(',')
  const eligibilityDirty =
    holderMode !== role.holderPolicy.mode ||
    anchorMode !== (role.anchorPolicy?.mode ?? 'unrestricted') ||
    [...userTypeIds].sort().join(',') !==
      (role.holderPolicy.mode === 'allow-list'
        ? [...role.holderPolicy.userTypeIds].sort().join(',')
        : '') ||
    [...orgTypeIds].sort().join(',') !==
      (role.anchorPolicy?.mode === 'allow-list'
        ? [...role.anchorPolicy.orgTypeIds].sort().join(',')
        : '')
  const grantableDirty =
    [...grantableIds].sort().join(',') !== [...(grantable.data?.roleIds ?? [])].sort().join(',')

  // permissions arrive sorted by code and grouped by whoever declared them;
  // the search narrows what is shown without touching what is ticked, so a
  // reader can find one box in a long catalog and leave the rest alone
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const buckets = new Map<string, { title: string; items: { code: string; label: string }[] }>()
    for (const permission of catalog.data?.permissions ?? []) {
      const label = formatText(permission.name)
      if (needle !== '' && !label.toLowerCase().includes(needle)) {
        if (!permission.code.toLowerCase().includes(needle)) continue
      }
      const key = permission.groupKey ?? permission.plugin
      const title = permission.group === null ? format(m.groupOther) : formatText(permission.group)
      const bucket = buckets.get(key) ?? { title, items: [] }
      bucket.items.push({ code: permission.code, label })
      buckets.set(key, bucket)
    }
    return [...buckets.values()].sort((a, b) => a.title.localeCompare(b.title))
  }, [catalog.data, search, format, formatText])

  const holder = role.holderPolicy
  const holderWord =
    holder.mode === 'unrestricted'
      ? format(m.anyoneWord)
      : (options.data?.userTypes ?? [])
          .filter((type) => holder.userTypeIds.includes(type.id))
          .map((type) => type.name)
          .join('、')
  const kindWord = format(role.kind === 'tenant' ? m.tenantGroup : m.orgGroup)

  return (
    <div {...stylex.props(styles.editor)}>
      <EditorHead
        title={role.name}
        chips={[
          { label: kindWord },
          ...(locked ? [{ label: format(m.systemBadge), tone: 'quiet' as const }] : []),
        ]}
        {...(locked ? { note: format(m.systemRoleHint) } : {})}
        actions={
          editable && (
            <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
              {format(m.rename)}
            </Button>
          )
        }
      />

      <div {...stylex.props(styles.factsStrip)}>
        <Facts
          items={[
            { label: format(m.factKind), value: kindWord },
            {
              label: format(m.factStatus),
              value: format(
                role.status === 'active'
                  ? m.enable
                  : role.status === 'draft'
                    ? m.draftBadge
                    : m.disabledBadge,
              ),
            },
            {
              label: format(m.factHolders),
              value:
                role.grantCount === 0
                  ? format(m.nobodyWord)
                  : format(m.assignmentCount, { count: role.grantCount }),
            },
            {
              label: format(m.factEligibility),
              value: holderWord === '' ? format(m.nobodyWord) : holderWord,
            },
          ]}
        />
      </div>

      <Feedback message={feedback} />

      <div {...stylex.props(styles.toolbar)}>
        <Segmented
          label={format(m.editRole)}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'permissions', label: format(m.tabPermissions) },
            { value: 'eligibility', label: format(m.tabEligibility) },
            ...(locked ? [] : [{ value: 'appointment' as const, label: format(m.tabAppointment) }]),
            { value: 'lifecycle', label: format(m.tabLifecycle) },
          ]}
        />
        <span {...stylex.props(styles.spacer)} />
        {tab === 'permissions' && !role.holdsEveryPermission && (
          <Input
            type="search"
            // the input adapter takes classes at its boundary; the compiled
            // StyleX class carries the sizing across it
            className={stylex.props(styles.search).className}
            aria-label={format(m.searchPermissions)}
            placeholder={format(m.searchPermissions)}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
      </div>

      {tab === 'permissions' &&
        (role.holdsEveryPermission ? (
          <p {...stylex.props(styles.quietNote)}>{format(m.everyPermission)}</p>
        ) : (
          <AsyncSection
            pending={catalog.isPending}
            error={catalog.isError ? formatError(catalog.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void catalog.refetch()}
          >
            {groups.length === 0 ? (
              <p {...stylex.props(styles.quietNote)}>{format(m.searchEmpty)}</p>
            ) : (
              <div {...stylex.props(styles.permissionGrid)}>
                {groups.map((group) => (
                  <PickList
                    key={group.title}
                    title={group.title}
                    count={format(m.pickedOf, {
                      picked: group.items.filter((item) => permissions.includes(item.code)).length,
                      total: group.items.length,
                    })}
                    toggleAllLabel={format(m.selectAll)}
                    disabled={!editable}
                    options={group.items.map((item) => ({
                      value: item.code,
                      label: item.label,
                      note: item.code,
                    }))}
                    selected={permissions}
                    onChange={setPermissions}
                  />
                ))}
              </div>
            )}
            {editable && (
              <SaveBar
                summary={`${format(m.permissionCount, { count: permissions.length })}　${format(
                  m.memberLine,
                  {
                    holders: role.grantCount,
                    appointers: grantable.data?.appointedBy.length ?? 0,
                  },
                )}`}
              >
                {permissionsDirty && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPermissions([...role.permissions])}
                  >
                    {format(m.discard)}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!permissionsDirty || savePermissions.isPending}
                  onClick={() => {
                    // A draft is nobody's duty yet and saves quietly. An
                    // active role IS a duty: everyone holding it changes the
                    // moment this lands, and every office appointing it hands
                    // out the new shape from now on - said out loud, with the
                    // real numbers.
                    if (role.status === 'active') {
                      setConfirmingPermissions(true)
                      return
                    }
                    savePermissions.mutate(undefined as never)
                  }}
                >
                  {format(m.savePermissions)}
                </Button>
              </SaveBar>
            )}
          </AsyncSection>
        ))}

      {tab === 'eligibility' && (
        <AsyncSection
          pending={options.isPending}
          error={options.isError ? formatError(options.error) : null}
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => void options.refetch()}
        >
          <div {...stylex.props(styles.stack)}>
            {/* the mode first, and the list only when it is the mode: an
                empty allow-list means nobody, which is a different rule from
                anybody */}
            <div {...stylex.props(styles.stackTight)}>
              <ModeChoice
                legend={format(m.userTypesLegend)}
                value={holderMode}
                onChange={setHolderMode}
                disabled={!editable}
                options={[
                  { value: 'unrestricted', label: format(m.eligibilityAnyone) },
                  { value: 'allow-list', label: format(m.eligibilityListed) },
                ]}
              />
              {holderMode === 'allow-list' && (
                <PickGrid
                  legend={format(m.userTypesLegend)}
                  emptyLabel={format(m.noOptions)}
                  disabled={!editable}
                  options={(options.data?.userTypes ?? []).map((type) => ({
                    value: type.id,
                    label: type.name,
                  }))}
                  selected={userTypeIds}
                  onChange={setUserTypeIds}
                />
              )}
            </div>

            {role.kind === 'org' && (
              <div {...stylex.props(styles.anchorSection)}>
                <ModeChoice
                  legend={format(m.orgTypesLegend)}
                  value={anchorMode}
                  onChange={setAnchorMode}
                  disabled={!editable}
                  options={[
                    { value: 'unrestricted', label: format(m.anchorAnywhere) },
                    { value: 'allow-list', label: format(m.anchorListed) },
                  ]}
                />
                {anchorMode === 'allow-list' && (
                  <PickGrid
                    legend={format(m.orgTypesLegend)}
                    emptyLabel={format(m.noOptions)}
                    disabled={!editable}
                    options={(options.data?.orgTypes ?? []).map((type) => ({
                      value: type.id,
                      label: type.name,
                    }))}
                    selected={orgTypeIds}
                    onChange={setOrgTypeIds}
                  />
                )}
              </div>
            )}

            {editable && (
              <SaveBar {...(eligibilityDirty ? { summary: format(m.unsaved) } : {})}>
                {eligibilityDirty && (
                  <Button variant="outline" size="sm" onClick={seed}>
                    {format(m.discard)}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!eligibilityDirty || saveEligibility.isPending}
                  onClick={() => saveEligibility.mutate(undefined as never)}
                >
                  {format(m.save)}
                </Button>
              </SaveBar>
            )}
          </div>
        </AsyncSection>
      )}

      {/* which offices this one appoints: the WHAT of granting, beside
          iam.grant.manage's WHERE. Nothing ticked means it appoints nobody. */}
      {tab === 'appointment' && !locked && (
        <AsyncSection
          pending={allRoles.isPending || grantable.isPending}
          error={
            allRoles.isError
              ? formatError(allRoles.error)
              : grantable.isError
                ? formatError(grantable.error)
                : null
          }
          loadingLabel={format(commonMessages.loading)}
          retryLabel={format(commonMessages.retry)}
          onRetry={() => {
            void allRoles.refetch()
            void grantable.refetch()
          }}
        >
          {permissions.includes(
            role.kind === 'tenant' ? 'iam.tenant-grant.manage' : 'iam.grant.manage',
          ) ? (
            <div {...stylex.props(styles.stackTight)}>
              <p {...stylex.props(styles.smallNote)}>{format(m.grantableHint)}</p>
              <PickGrid
                legend={format(m.grantableLegend)}
                emptyLabel={format(m.noOptions)}
                disabled={!editable}
                options={(allRoles.data?.roles ?? [])
                  .filter(
                    (candidate) =>
                      candidate.systemKey === null &&
                      candidate.id !== role.id &&
                      candidate.kind === role.kind,
                  )
                  .map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                selected={grantableIds}
                onChange={setGrantableIds}
              />
              {editable && (
                <SaveBar {...(grantableDirty ? { summary: format(m.unsaved) } : {})}>
                  {grantableDirty && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGrantableIds([...(grantable.data?.roleIds ?? [])])}
                    >
                      {format(m.discard)}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!grantableDirty || saveGrantable.isPending}
                    onClick={() => saveGrantable.mutate(undefined as never)}
                  >
                    {format(m.save)}
                  </Button>
                </SaveBar>
              )}
            </div>
          ) : (
            <p {...stylex.props(styles.quietNote)}>{format(m.grantableNeedsManage)}</p>
          )}
        </AsyncSection>
      )}

      {tab === 'lifecycle' && (
        <div {...stylex.props(styles.stack)}>
          <DefRow
            label={format(m.statusLegend)}
            action={
              editable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate(role.status === 'active' ? 'disabled' : 'active')}
                >
                  {format(role.status === 'active' ? m.disable : m.enable)}
                </Button>
              )
            }
          >
            {format(
              role.status === 'active'
                ? m.enable
                : role.status === 'draft'
                  ? m.draftBadge
                  : m.disabledBadge,
            )}
          </DefRow>
          <DefRow
            label={format(m.assignableLegend)}
            action={
              editable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={setAssignable.isPending}
                  onClick={() => setAssignable.mutate(!role.assignable)}
                >
                  {format(m.assignableLabel)}
                </Button>
              )
            }
          >
            {format(role.assignable ? m.assignableOn : m.assignableOff)}
          </DefRow>
          {editable && (
            <SaveBar summary={format(m.assignmentCount, { count: role.grantCount })}>
              <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
                {format(m.delete)}
              </Button>
            </SaveBar>
          )}
        </div>
      )}

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
              form="rename-role"
              disabled={saveProfile.isPending || name.trim() === ''}
            >
              {format(m.save)}
            </Button>
          </>
        }
      >
        <form
          id="rename-role"
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
        open={confirmingPermissions}
        title={format(m.confirmPermissionsTitle)}
        description={format(m.confirmPermissionsBody, {
          holders: role.grantCount,
          appointers: grantable.data?.appointedBy.length ?? 0,
        })}
        confirmLabel={format(m.save)}
        cancelLabel={format(m.cancel)}
        pending={savePermissions.isPending}
        onConfirm={() => savePermissions.mutate(undefined as never)}
        onCancel={() => setConfirmingPermissions(false)}
      />

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
    </div>
  )
}
