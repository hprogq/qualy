import type { ApiResult } from '@qualy/web-runtime/api'
import type { Effect } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { PageLink, useApi, useRunApi, useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import {
  BandBack,
  Card,
  CardEmpty,
  CardFoot,
  CardHint,
  FactStrip,
  FootNote,
  Screen,
  SearchField,
  Segmented,
  Spacer,
  Tag,
  Tick,
  TickGrid,
  UnsavedMark,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { rbacMessages as m } from './i18n.ts'
import { accessApi } from './api.ts'

// One role, on a page of its own.
//
// The two switches that matter most - whether it is in force, whether it may
// still be handed out - stand first, with what each means said beside them
// and the way to remove the role at the far end of the same bar. Under them,
// one strip of facts that summarises the three things a role is configured
// in, and those three as tabs of one card: what it may do, who may hold it,
// which offices it appoints. Tabs rather than columns because the three are
// wildly different heights, and side by side two of them are always mostly
// empty.
/** the row as the api answers it, not a copy that can drift from it */
export type RoleRow = ApiResult<typeof accessApi, 'access', 'listRoles'>['roles'][number]

type Tab = 'permissions' | 'eligibility' | 'appointment'

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  // the switches, what they mean, and the way out - one bar
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    columnGap: 24,
    rowGap: 12,
    paddingInline: 16,
    paddingBlock: 12,
    flexWrap: 'wrap',
  },
  switch: { display: 'inline-flex', alignItems: 'center', gap: 10 },
  switchLabel: { fontSize: 13, fontWeight: 600 },
  rule: {
    display: { default: 'block', [breakpoints.phone]: 'none' },
    width: 1,
    height: 10,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
  },
  meaning: { minWidth: 0, flexGrow: 1, flexBasis: '16rem', fontSize: 12, lineHeight: 1.5, color: QUIET },
  removal: { display: 'inline-flex', alignItems: 'center', gap: 10 },
  removalWhy: { fontSize: 12, color: tokens.mutedForeground },
  tabsRow: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    overflowX: 'auto',
  },
  tabList: { gap: 0 },
  tab: { height: 42, paddingInline: 12, fontSize: 13 },
  tabCount: { marginLeft: 6, fontSize: 11.5, fontVariantNumeric: 'tabular-nums', color: QUIET },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    flexWrap: 'wrap',
  },
  search: { width: { default: '14rem', [breakpoints.phone]: '100%' } },
  selectAll: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 500,
    color: { default: tokens.surfaceMutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  toolbarNote: { fontSize: 12, color: QUIET },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    paddingInline: 16,
    paddingBlock: 12,
    borderBottomWidth: { default: 1, ':last-of-type': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  groupHead: { display: 'flex', alignItems: 'baseline', gap: 8 },
  groupTitle: { fontSize: 12, fontWeight: 600 },
  groupCount: { fontSize: 11, fontVariantNumeric: 'tabular-nums', color: QUIET },
  part: {
    display: 'flex',
    flexDirection: 'column',
    borderBottomWidth: { default: 1, ':last-of-type': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  partHead: { display: 'flex', alignItems: 'center', gap: 10, paddingInline: 16, paddingTop: 12, flexWrap: 'wrap' },
  partTitle: { fontSize: 13, fontWeight: 600 },
  spacer: { flexGrow: 1 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
})

export function RoleEditor({ role, canManage }: { role: RoleRow; canManage: boolean }) {
  const api = useApi(accessApi)
  const runApi = useRunApi()
  const query = useApiQuery(accessApi)
  const queryClient = useQueryClient()
  const { format, formatError, formatText } = useI18n()
  const listJoin = useList()
  const navigate = usePageNavigate()
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
    query.access.listPermissions.queryOptions({
      query: { target: role.kind === 'org' ? 'org-node' : 'tenant' },
    }),
  )
  const options = useQuery(query.access.getRoleOptions.queryOptions())
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
  const allRoles = useQuery(query.access.listRoles.queryOptions({ query: {} }))
  const grantable = useQuery({
    ...query.access.getRoleGrantableRoles.queryOptions({ params: { roleId: role.id } }),
    enabled: !locked,
  })
  const [grantableIds, setGrantableIds] = useState<string[]>([])
  useEffect(() => {
    setGrantableIds([...(grantable.data?.roleIds ?? [])])
  }, [grantable.data])

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.access.key() })
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
      // the page of a role that is gone is a page about nothing
      navigate('rbac/roles')
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
    const buckets = new Map<
      string,
      { title: string; items: { code: string; label: string; note?: string }[] }
    >()
    for (const permission of catalog.data?.permissions ?? []) {
      const label = formatText(permission.name)
      if (needle !== '' && !label.toLowerCase().includes(needle)) {
        if (!permission.code.toLowerCase().includes(needle)) continue
      }
      const key = permission.groupKey ?? permission.plugin
      const title = permission.group === null ? format(m.groupOther) : formatText(permission.group)
      const bucket = buckets.get(key) ?? { title, items: [] }
      // what the duty amounts to, where its owner wrote that down: a code says
      // nothing to whoever is deciding whether a counsellor should have it
      bucket.items.push({
        code: permission.code,
        label,
        ...(permission.description === null ? {} : { note: formatText(permission.description) }),
      })
      buckets.set(key, bucket)
    }
    return [...buckets.values()].sort((a, b) => a.title.localeCompare(b.title))
  }, [catalog.data, search, format, formatText])

  const holder = role.holderPolicy
  // the canonical administrator is the one role eligibility does not apply
  // to, so its empty list is an exemption rather than something left unsaid
  const holderWord = locked
    ? format(m.exemptWord)
    : holder.mode === 'unrestricted'
      ? format(m.anyoneWord)
      : listJoin(
          (options.data?.userTypes ?? [])
            .filter((type) => holder.userTypeIds.includes(type.id))
            .map((type) => type.name),
        )
  const kindWord = format(role.kind === 'tenant' ? m.tenantGroup : m.orgGroup)

  const orgWord =
    role.anchorPolicy === null
      ? format(m.notApplicable)
      : role.anchorPolicy.mode === 'unrestricted'
        ? format(m.anywhereWord)
        : listJoin(
            (options.data?.orgTypes ?? [])
              .filter((type) => role.anchorPolicy?.mode === 'allow-list' && role.anchorPolicy.orgTypeIds.includes(type.id))
              .map((type) => type.name),
          )
  const appoints = listJoin(
    (allRoles.data?.roles ?? [])
      .filter((candidate) => (grantable.data?.roleIds ?? []).includes(candidate.id))
      .map((candidate) => candidate.name),
  )
  const catalogTotal = catalog.data?.permissions.length ?? 0
  const shownCodes = groups.flatMap((group) => group.items.map((item) => item.code))
  const allShownPicked = shownCodes.length > 0 && shownCodes.every((code) => permissions.includes(code))

  return (
    <Screen
      back={
        <BandBack as={PageLink} page="rbac/roles">
          {format(m.backToRoles)}
        </BandBack>
      }
      title={role.name}
      titleAside={
        <>
          <Tag>{kindWord}</Tag>
          {locked && <Tag>{format(m.systemBadge)}</Tag>}
        </>
      }
      description={format(
        locked ? m.systemRoleHint : role.kind === 'tenant' ? m.tenantGroupHint : m.orgGroupHint,
      )}
      actions={
        editable && (
          <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
            {format(m.rename)}
          </Button>
        )
      }
    >
      <Feedback message={feedback} />

      <Card data-testid="role-standing" data-status={role.status} data-assignable={role.assignable}>
        <div {...stylex.props(styles.statusBar)}>
          <span {...stylex.props(styles.switch)}>
            <span {...stylex.props(styles.switchLabel)}>{format(m.statusLegend)}</span>
            {editable ? (
              <Segmented
                label={format(m.statusLegend)}
                value={role.status === 'active' ? 'on' : 'off'}
                onChange={(next) => {
                  if (setStatus.isPending) return
                  if (next === 'on' && role.status !== 'active') setStatus.mutate('active')
                  if (next === 'off' && role.status === 'active') setStatus.mutate('disabled')
                }}
                options={[
                  { value: 'on', label: format(m.statusOn) },
                  {
                    value: 'off',
                    // a draft has never been in force, which is not the same as switched off
                    label: format(role.status === 'draft' ? m.draftBadge : m.statusOff),
                  },
                ]}
              />
            ) : (
              <Tag>
                {format(
                  role.status === 'active' ? m.statusOn : role.status === 'draft' ? m.draftBadge : m.disabledBadge,
                )}
              </Tag>
            )}
          </span>
          <span aria-hidden {...stylex.props(styles.rule)} />
          <span {...stylex.props(styles.switch)}>
            <span {...stylex.props(styles.switchLabel)}>{format(m.assignableLegend)}</span>
            {editable ? (
              <Segmented
                label={format(m.assignableLegend)}
                value={role.assignable ? 'yes' : 'no'}
                onChange={(next) => {
                  if (setAssignable.isPending) return
                  if ((next === 'yes') !== role.assignable) setAssignable.mutate(next === 'yes')
                }}
                options={[
                  { value: 'yes', label: format(m.assignableOn) },
                  { value: 'no', label: format(m.assignableOff) },
                ]}
              />
            ) : (
              <Tag>{format(role.assignable ? m.assignableOn : m.assignableOff)}</Tag>
            )}
          </span>
          <span {...stylex.props(styles.meaning)}>{format(m.standingMeaning)}</span>
          {editable && (
            <span {...stylex.props(styles.removal)}>
              {role.grantCount > 0 && (
                <span {...stylex.props(styles.removalWhy)}>
                  {format(m.roleStillHeld, { count: role.grantCount })}
                </span>
              )}
              <Button
                size="xs"
                variant="outline"
                disabled={role.grantCount > 0}
                onClick={() => setConfirmingDelete(true)}
              >
                {format(m.deleteRole)}
              </Button>
            </span>
          )}
        </div>
      </Card>

      <FactStrip
        testId="role-facts"
        columns={role.kind === 'org' ? 5 : 4}
        items={[
          {
            label: format(m.factHolders),
            value: role.grantCount === 0 ? format(m.nobodyWord) : format(m.holderCount, { count: role.grantCount }),
          },
          { label: format(m.columnHolders), value: holderWord === '' ? format(m.unsetWord) : holderWord },
          ...(role.kind === 'org'
            ? [{ label: format(m.columnAnchors), value: orgWord === '' ? format(m.unsetWord) : orgWord }]
            : []),
          { label: format(m.tabAppointment), value: locked ? format(m.everyWord) : appoints === '' ? format(m.nobodyWord) : appoints },
          {
            label: format(m.tabPermissions),
            value: role.holdsEveryPermission
              ? format(m.everyWord)
              : format(m.countItems, { count: role.permissions.length }),
          },
        ]}
      />

      <Card data-testid="role-config" data-tab={tab}>
        <div {...stylex.props(styles.tabsRow)}>
          <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)}>
            <TabsList xstyle={styles.tabList}>
              <TabsTrigger value="permissions" xstyle={styles.tab}>
                {format(m.tabPermissions)}
                {!role.holdsEveryPermission && (
                  <span {...stylex.props(styles.tabCount)}>
                    {format(m.pickedOf, { picked: permissions.length, total: catalogTotal })}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="eligibility" xstyle={styles.tab}>
                {format(m.tabEligibility)}
              </TabsTrigger>
              {!locked && (
                <TabsTrigger value="appointment" xstyle={styles.tab}>
                  {format(m.tabAppointment)}
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </div>

        {tab === 'permissions' &&
          (role.holdsEveryPermission ? (
            <CardEmpty>{format(m.everyPermission)}</CardEmpty>
          ) : (
            <AsyncSection
              pending={catalog.isPending}
              error={catalog.isError ? formatError(catalog.error) : null}
              loadingLabel={format(commonMessages.loading)}
              retryLabel={format(commonMessages.retry)}
              onRetry={() => void catalog.refetch()}
            >
              <div {...stylex.props(styles.toolbar)}>
                <SearchField
                  value={search}
                  onChange={setSearch}
                  label={format(m.searchPermissions)}
                  xstyle={styles.search}
                />
                {editable && shownCodes.length > 0 && (
                  <button
                    type="button"
                    {...stylex.props(styles.selectAll)}
                    onClick={() =>
                      setPermissions(
                        allShownPicked
                          ? permissions.filter((code) => !shownCodes.includes(code))
                          : [...new Set([...permissions, ...shownCodes])],
                      )
                    }
                  >
                    {format(allShownPicked ? m.selectNone : m.selectAll)}
                  </button>
                )}
                <span {...stylex.props(styles.spacer)} />
                <span {...stylex.props(styles.toolbarNote)}>
                  {format(role.kind === 'org' ? m.catalogOrgOnly : m.catalogTenantOnly)}
                </span>
              </div>
              {groups.length === 0 ? (
                <CardEmpty>{format(m.searchEmpty)}</CardEmpty>
              ) : (
                groups.map((group) => (
                  <div key={group.title} {...stylex.props(styles.group)} data-testid="permission-group">
                    <span {...stylex.props(styles.groupHead)}>
                      <span {...stylex.props(styles.groupTitle)}>{group.title}</span>
                      <span {...stylex.props(styles.groupCount)}>
                        {format(m.pickedOf, {
                          picked: group.items.filter((item) => permissions.includes(item.code)).length,
                          total: group.items.length,
                        })}
                      </span>
                    </span>
                    <TickGrid columns={3} flush label={group.title}>
                      {group.items.map((item) => (
                        <Tick
                          key={item.code}
                          label={item.label}
                          {...(item.note === undefined ? {} : { note: item.note })}
                          checked={permissions.includes(item.code)}
                          disabled={!editable}
                          data-permission={item.code}
                          onChange={(next) =>
                            setPermissions(
                              next
                                ? [...permissions, item.code]
                                : permissions.filter((code) => code !== item.code),
                            )
                          }
                        />
                      ))}
                    </TickGrid>
                  </div>
                ))
              )}
              {editable && (
                <CardFoot inset>
                  <FootNote>
                    {format(m.memberLine, {
                      holders: role.grantCount,
                      appointers: grantable.data?.appointedBy.length ?? 0,
                    })}
                  </FootNote>
                  <Spacer />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!permissionsDirty}
                    onClick={() => setPermissions([...role.permissions])}
                  >
                    {format(m.discard)}
                  </Button>
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
                </CardFoot>
              )}
            </AsyncSection>
          ))}

        {tab === 'eligibility' && locked && <CardEmpty>{format(m.exemptHint)}</CardEmpty>}
        {tab === 'eligibility' && !locked && (
          <AsyncSection
            pending={options.isPending}
            error={options.isError ? formatError(options.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void options.refetch()}
          >
            {/* the mode first, and the list only when it is the mode: an
                empty allow-list means nobody, which is a different rule from
                anybody */}
            <div {...stylex.props(styles.part)}>
              <div {...stylex.props(styles.partHead)}>
                <span {...stylex.props(styles.partTitle)}>{format(m.userTypesLegend)}</span>
                <span {...stylex.props(styles.spacer)} />
                <Segmented
                  label={format(m.userTypesLegend)}
                  value={holderMode}
                  onChange={(next) => editable && setHolderMode(next)}
                  options={[
                    { value: 'unrestricted', label: format(m.eligibilityAnyone) },
                    { value: 'allow-list', label: format(m.eligibilityListed) },
                  ]}
                />
              </div>
              {holderMode === 'allow-list' ? (
                <TickGrid columns={3} label={format(m.userTypesLegend)}>
                  {(options.data?.userTypes ?? []).map((type) => (
                    <Tick
                      key={type.id}
                      label={type.name}
                      checked={userTypeIds.includes(type.id)}
                      disabled={!editable}
                      onChange={(next) =>
                        setUserTypeIds(
                          next ? [...userTypeIds, type.id] : userTypeIds.filter((id) => id !== type.id),
                        )
                      }
                    />
                  ))}
                </TickGrid>
              ) : (
                <CardHint top>{format(m.anyoneWord)}</CardHint>
              )}
            </div>

            {role.kind === 'org' && (
              <div {...stylex.props(styles.part)}>
                <div {...stylex.props(styles.partHead)}>
                  <span {...stylex.props(styles.partTitle)}>{format(m.orgTypesLegend)}</span>
                  <span {...stylex.props(styles.spacer)} />
                  <Segmented
                    label={format(m.orgTypesLegend)}
                    value={anchorMode}
                    onChange={(next) => editable && setAnchorMode(next)}
                    options={[
                      { value: 'unrestricted', label: format(m.anchorAnywhere) },
                      { value: 'allow-list', label: format(m.anchorListed) },
                    ]}
                  />
                </div>
                {anchorMode === 'allow-list' ? (
                  <TickGrid columns={3} label={format(m.orgTypesLegend)}>
                    {(options.data?.orgTypes ?? []).map((type) => (
                      <Tick
                        key={type.id}
                        label={type.name}
                        checked={orgTypeIds.includes(type.id)}
                        disabled={!editable}
                        onChange={(next) =>
                          setOrgTypeIds(
                            next ? [...orgTypeIds, type.id] : orgTypeIds.filter((id) => id !== type.id),
                          )
                        }
                      />
                    ))}
                  </TickGrid>
                ) : (
                  <CardHint top>{format(m.anywhereWord)}</CardHint>
                )}
              </div>
            )}

            {editable && (
              <CardFoot inset>
                {eligibilityDirty && <UnsavedMark>{format(m.unsaved)}</UnsavedMark>}
                <Spacer />
                <Button variant="ghost" size="sm" disabled={!eligibilityDirty} onClick={seed}>
                  {format(m.discard)}
                </Button>
                <Button
                  size="sm"
                  disabled={!eligibilityDirty || saveEligibility.isPending}
                  onClick={() => saveEligibility.mutate(undefined as never)}
                >
                  {format(m.save)}
                </Button>
              </CardFoot>
            )}
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
              <>
                <TickGrid columns={3} label={format(m.grantableLegend)}>
                  {(allRoles.data?.roles ?? [])
                    .filter(
                      (candidate) =>
                        candidate.systemKey === null &&
                        candidate.id !== role.id &&
                        candidate.kind === role.kind,
                    )
                    .map((candidate) => (
                      <Tick
                        key={candidate.id}
                        label={candidate.name}
                        checked={grantableIds.includes(candidate.id)}
                        disabled={!editable}
                        onChange={(next) =>
                          setGrantableIds(
                            next
                              ? [...grantableIds, candidate.id]
                              : grantableIds.filter((id) => id !== candidate.id),
                          )
                        }
                      />
                    ))}
                </TickGrid>
                <CardHint>{format(m.grantableHint)}</CardHint>
                {editable && (
                  <CardFoot inset>
                    {grantableDirty && <UnsavedMark>{format(m.unsaved)}</UnsavedMark>}
                    <Spacer />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!grantableDirty}
                      onClick={() => setGrantableIds([...(grantable.data?.roleIds ?? [])])}
                    >
                      {format(m.discard)}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!grantableDirty || saveGrantable.isPending}
                      onClick={() => saveGrantable.mutate(undefined as never)}
                    >
                      {format(m.save)}
                    </Button>
                  </CardFoot>
                )}
              </>
            ) : (
              <CardEmpty>{format(m.grantableNeedsManage)}</CardEmpty>
            )}
          </AsyncSection>
        )}
      </Card>

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
    </Screen>
  )
}
