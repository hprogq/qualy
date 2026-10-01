import { assertNever, getApiErrorCode, useList } from '@qualy/web-i18n'
import {
  useApiMutation,
  PageLink,
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageNavigate,
} from '@qualy/web-runtime'

import { type ApiResult } from '@qualy/web-runtime/api'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

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

import { accessApi } from './api.ts'
import { ModeCards } from './ModeCards.tsx'
import { RoleHolders } from './RoleHolders.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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

type Tab = 'permissions' | 'eligibility' | 'appointment' | 'holders'

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
  meaning: {
    minWidth: 0,
    flexGrow: 1,
    flexBasis: '16rem',
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
  },
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
  tabCount: {
    marginLeft: 6,
    fontSize: 11.5,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
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
  toolbarNote: { fontSize: 12, color: tokens.mutedForeground },
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
  groupCount: { fontSize: 11, fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  part: {
    display: 'flex',
    flexDirection: 'column',
    borderBottomWidth: { default: 1, ':last-of-type': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  partBody: { paddingInline: 16, paddingTop: 10, paddingBottom: 6 },
  partHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingInline: 16,
    paddingTop: 12,
    flexWrap: 'wrap',
  },
  partTitle: { fontSize: 13, fontWeight: 600 },
  spacer: { flexGrow: 1 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
})

export function RoleEditor({ role, canManage }: { role: RoleRow; canManage: boolean }) {
  const api = useApi(accessApi)

  const query = useApiQuery(accessApi)
  const queryClient = useQueryClient()

  const describe = useLoadFailure()
  const listJoin = useList()
  const navigate = usePageNavigate()
  const [tab, setTab] = useState<Tab>('permissions')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  // what a rename was refused for is said in its dialog, not behind it: a
  // name another role has under the name, anything else above the fields
  const [renameRefusal, setRenameRefusal] = useState<{
    readonly taken: boolean
    readonly said: string
  } | null>(null)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded per record, not per render's seed
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

  const saveProfile = useApiMutation({
    mutationFn: () =>
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
    onMutate: () => setRenameRefusal(null),
    onSuccess: async () => {
      setRenaming(false)
      await refresh()
    },
    onError: (error) => {
      let failure: string
      switch (error._tag) {
        case 'ROLE_CONFLICT':
          failure = m.error_roleConflict()
          break
        case 'ROLE_IS_SYSTEM':
          failure = m.error_roleIsSystem()
          break
        case 'ROLE_NOT_FOUND':
          failure = m.error_roleNotFound()
          break
        case 'ROLE_VERSION_CONFLICT':
          failure = m.error_roleVersionConflict()
          break
        default:
          assertNever(error)
      }
      setRenameRefusal({
        taken: getApiErrorCode(error) === 'ROLE_CONFLICT',
        said: failure,
      })
    },
  })
  const closeRename = () => {
    setRenaming(false)
    setRenameRefusal(null)
  }
  const savePermissions = useApiMutation({
    mutationFn: () =>
      api.access.setRolePermissions({
        params: { roleId: role.id },
        payload: { version: role.version, codes: permissions },
      }),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await refresh()
    },
    onError: (error) => {
      switch (error._tag) {
        case 'LAST_ADMINISTRATOR':
          setFeedback(m.error_lastAdministrator())
          return
        case 'PERMISSION_NOT_FOUND':
          setFeedback(m.error_permissionNotFound({ count: error.permissions.length }))
          return
        case 'ROLE_APPOINTMENT_INVALID':
          setFeedback(m.error_roleAppointmentInvalid({ reason: error.reason }))
          return
        case 'ROLE_CONFLICT':
          setFeedback(m.error_roleConflict())
          return
        case 'ROLE_ESCALATION_REFUSED':
          setFeedback(m.error_roleEscalationRefused({ count: error.permissions.length }))
          return
        case 'ROLE_INCOMPLETE':
          setFeedback(m.error_roleIncomplete({ missing: error.missing.join(', ') }))
          return
        case 'ROLE_IS_SYSTEM':
          setFeedback(m.error_roleIsSystem())
          return
        case 'ROLE_NOT_FOUND':
          setFeedback(m.error_roleNotFound())
          return
        case 'ROLE_TARGET_MISMATCH':
          setFeedback(m.error_roleTargetMismatch({ count: error.permissions.length }))
          return
        case 'ROLE_VERSION_CONFLICT':
          setFeedback(m.error_roleVersionConflict())
          return
        default:
          assertNever(error)
      }
    },
    onSettled: () => setConfirmingPermissions(false),
  })
  const saveEligibility = useApiMutation({
    mutationFn: () =>
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
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await refresh()
    },
    onError: (error) => {
      switch (error._tag) {
        case 'GRANT_STRANDED':
          setFeedback(m.error_grantStranded({ assignmentCount: error.grantCount }))
          return
        case 'ROLE_ANCHOR_MISMATCH':
          setFeedback(m.error_roleAnchorMismatch())
          return
        case 'ROLE_CONFLICT':
          setFeedback(m.error_roleConflict())
          return
        case 'ROLE_IS_SYSTEM':
          setFeedback(m.error_roleIsSystem())
          return
        case 'ROLE_NEEDS_ELIGIBILITY':
          setFeedback(m.error_roleNeedsEligibility())
          return
        case 'ROLE_NOT_FOUND':
          setFeedback(m.error_roleNotFound())
          return
        case 'ROLE_ORG_TYPE_NOT_FOUND':
          setFeedback(m.error_roleOrgTypeNotFound())
          return
        case 'ROLE_USER_TYPE_NOT_FOUND':
          setFeedback(m.error_roleUserTypeNotFound())
          return
        case 'ROLE_VERSION_CONFLICT':
          setFeedback(m.error_roleVersionConflict())
          return
        default:
          assertNever(error)
      }
    },
  })
  const saveGrantable = useApiMutation({
    mutationFn: () =>
      api.access.setRoleGrantableRoles({
        params: { roleId: role.id },
        payload: { version: role.version, roleIds: grantableIds },
      }),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await refresh()
    },
    onError: (error) => {
      switch (error._tag) {
        case 'ROLE_APPOINTMENT_INVALID':
          setFeedback(m.error_roleAppointmentInvalid({ reason: error.reason }))
          return
        case 'ROLE_CONFLICT':
          setFeedback(m.error_roleConflict())
          return
        case 'ROLE_ESCALATION_REFUSED':
          setFeedback(m.error_roleEscalationRefused({ count: error.permissions.length }))
          return
        case 'ROLE_IS_SYSTEM':
          setFeedback(m.error_roleIsSystem())
          return
        case 'ROLE_NOT_FOUND':
          setFeedback(m.error_roleNotFound())
          return
        case 'ROLE_VERSION_CONFLICT':
          setFeedback(m.error_roleVersionConflict())
          return
        default:
          assertNever(error)
      }
    },
  })
  const setAssignable = useApiMutation({
    mutationFn: (assignable: boolean) =>
      api.access.updateRole({
        params: { roleId: role.id },
        payload: { version: role.version, assignable },
      }),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await refresh()
    },
    onError: (error) => {
      switch (error._tag) {
        case 'ROLE_CONFLICT':
          setFeedback(m.error_roleConflict())
          return
        case 'ROLE_IS_SYSTEM':
          setFeedback(m.error_roleIsSystem())
          return
        case 'ROLE_NOT_FOUND':
          setFeedback(m.error_roleNotFound())
          return
        case 'ROLE_VERSION_CONFLICT':
          setFeedback(m.error_roleVersionConflict())
          return
        default:
          assertNever(error)
      }
    },
  })
  const setStatus = useApiMutation({
    mutationFn: (status: 'active' | 'disabled') =>
      api.access.setRoleStatus({
        params: { roleId: role.id },
        payload: { version: role.version, status },
      }),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await refresh()
    },
    onError: (error) => {
      switch (error._tag) {
        case 'LAST_ADMINISTRATOR':
          setFeedback(m.error_lastAdministrator())
          return
        case 'ROLE_CONFLICT':
          setFeedback(m.error_roleConflict())
          return
        case 'ROLE_ESCALATION_REFUSED':
          setFeedback(m.error_roleEscalationRefused({ count: error.permissions.length }))
          return
        case 'ROLE_INCOMPLETE':
          setFeedback(m.error_roleIncomplete({ missing: error.missing.join(', ') }))
          return
        case 'ROLE_IS_SYSTEM':
          setFeedback(m.error_roleIsSystem())
          return
        case 'ROLE_NOT_DRAFT':
          setFeedback(m.error_roleNotDraft())
          return
        case 'ROLE_NOT_FOUND':
          setFeedback(m.error_roleNotFound())
          return
        case 'ROLE_VERSION_CONFLICT':
          setFeedback(m.error_roleVersionConflict())
          return
        default:
          assertNever(error)
      }
    },
  })
  const remove = useApiMutation({
    mutationFn: () =>
      api.access.deleteRole({
        params: { roleId: role.id },
        query: { version: String(role.version) },
      }),
    onMutate: () => setFeedback(null),
    onError: (error) => {
      switch (error._tag) {
        case 'ROLE_CONFLICT':
          setFeedback(m.error_roleConflict())
          return
        case 'ROLE_HAS_GRANT_HISTORY':
          setFeedback(m.error_roleHasGrantHistory())
          return
        case 'ROLE_IS_SYSTEM':
          setFeedback(m.error_roleIsSystem())
          return
        case 'ROLE_NOT_FOUND':
          setFeedback(m.error_roleNotFound())
          return
        case 'ROLE_VERSION_CONFLICT':
          setFeedback(m.error_roleVersionConflict())
          return
        default:
          assertNever(error)
      }
    },
    onSuccess: async () => {
      setConfirmingDelete(false)
      await refresh()
      // the page of a role that is gone is a page about nothing
      navigate('rbac/roles')
    },
  })

  const editable = canManage && !locked
  const [standing, setStanding] = useState<
    { status: 'active' | 'disabled' } | { assignable: boolean } | null
  >(null)
  const [leaving, setLeaving] = useState<Tab | null>(null)
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
  const tabDirty =
    (tab === 'permissions' && permissionsDirty) ||
    (tab === 'eligibility' && eligibilityDirty) ||
    (tab === 'appointment' && grantableDirty)
  /** put the open tab back to what is stored */
  const discardTab = () => {
    if (tab === 'appointment') setGrantableIds([...(grantable.data?.roleIds ?? [])])
    else seed()
  }
  /** save the open tab the way its own button would, then go where the reader was going */
  const saveTabThen = (next: Tab) => {
    const go = { onSuccess: () => setTab(next) }
    if (tab === 'permissions') {
      // an active role's permissions are confirmed with their reach said out
      // loud; that dialog takes over, and the reader moves on from there
      if (role.status === 'active') setConfirmingPermissions(true)
      else savePermissions.mutate(undefined, go)
    } else if (tab === 'eligibility') saveEligibility.mutate(undefined, go)
    else if (tab === 'appointment') saveGrantable.mutate(undefined, go)
  }

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
      const label = permission.name
      if (needle !== '' && !label.toLowerCase().includes(needle)) {
        if (!permission.code.toLowerCase().includes(needle)) continue
      }
      const key = permission.groupKey ?? permission.plugin
      const title = permission.group === null ? m.roles_groupOther() : permission.group
      const bucket = buckets.get(key) ?? { title, items: [] }
      // what the duty amounts to, where its owner wrote that down: a code says
      // nothing to whoever is deciding whether a counsellor should have it
      bucket.items.push({
        code: permission.code,
        label,
        ...(permission.description === null ? {} : { note: permission.description }),
      })
      buckets.set(key, bucket)
    }
    return [...buckets.values()].sort((a, b) => a.title.localeCompare(b.title))
  }, [catalog.data, search])

  const holder = role.holderPolicy
  // the canonical administrator is the one role eligibility does not apply
  // to, so its empty list is an exemption rather than something left unsaid
  const holderWord = locked
    ? m.roles_exempt()
    : holder.mode === 'unrestricted'
      ? m.roles_anyone()
      : listJoin(
          (options.data?.userTypes ?? [])
            .filter((type) => holder.userTypeIds.includes(type.id))
            .map((type) => type.name),
        )
  const kindWord = (role.kind === 'tenant' ? m.roles_tenantGroup : m.roles_orgGroup)()

  const orgWord =
    role.anchorPolicy === null
      ? m.roles_notApplicable()
      : role.anchorPolicy.mode === 'unrestricted'
        ? m.roles_anywhere()
        : listJoin(
            (options.data?.orgTypes ?? [])
              .filter(
                (type) =>
                  role.anchorPolicy?.mode === 'allow-list' &&
                  role.anchorPolicy.orgTypeIds.includes(type.id),
              )
              .map((type) => type.name),
          )
  const appoints = listJoin(
    (allRoles.data?.roles ?? [])
      .filter((candidate) => (grantable.data?.roleIds ?? []).includes(candidate.id))
      .map((candidate) => candidate.name),
  )
  const catalogTotal = catalog.data?.permissions.length ?? 0
  const shownCodes = groups.flatMap((group) => group.items.map((item) => item.code))
  const allShownPicked =
    shownCodes.length > 0 && shownCodes.every((code) => permissions.includes(code))

  return (
    <Screen
      back={
        <BandBack as={PageLink} page="rbac/roles">
          {m.roles_back()}
        </BandBack>
      }
      title={role.name}
      titleAside={
        <>
          <Tag>{kindWord}</Tag>
          {locked && <Tag>{m.badge_system()}</Tag>}
        </>
      }
      description={(locked
        ? m.roles_systemHint
        : role.kind === 'tenant'
          ? m.roles_tenantGroupHint
          : m.roles_orgGroupHint)()}
      actions={
        editable && (
          <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
            {m.action_rename()}
          </Button>
        )
      }
    >
      <Feedback message={feedback} />

      <Card data-testid="role-standing" data-status={role.status} data-assignable={role.assignable}>
        <div {...stylex.props(styles.statusBar)}>
          <span {...stylex.props(styles.switch)}>
            <span {...stylex.props(styles.switchLabel)}>{m.roles_statusLegend()}</span>
            {editable ? (
              <Segmented
                label={m.roles_statusLegend()}
                value={role.status === 'active' ? 'on' : 'off'}
                onChange={(next) => {
                  if (setStatus.isPending) return
                  // asked about first: everybody holding the role gains or
                  // loses what it grants the moment this lands
                  if (next === 'on' && role.status !== 'active') setStanding({ status: 'active' })
                  if (next === 'off' && role.status === 'active')
                    setStanding({ status: 'disabled' })
                }}
                options={[
                  { value: 'on', label: m.roles_statusOn() },
                  {
                    value: 'off',
                    // a draft has never been in force, which is not the same as switched off
                    label: (role.status === 'draft' ? m.badge_draft : m.roles_statusOff)(),
                  },
                ]}
              />
            ) : (
              <Tag>
                {(role.status === 'active'
                  ? m.roles_statusOn
                  : role.status === 'draft'
                    ? m.badge_draft
                    : m.badge_disabled)()}
              </Tag>
            )}
          </span>
          <span aria-hidden {...stylex.props(styles.rule)} />
          <span {...stylex.props(styles.switch)}>
            <span {...stylex.props(styles.switchLabel)}>{m.roles_assignableLegend()}</span>
            {editable ? (
              <Segmented
                label={m.roles_assignableLegend()}
                value={role.assignable ? 'yes' : 'no'}
                onChange={(next) => {
                  if (setAssignable.isPending) return
                  if ((next === 'yes') !== role.assignable)
                    setStanding({ assignable: next === 'yes' })
                }}
                options={[
                  { value: 'yes', label: m.roles_assignableOn() },
                  { value: 'no', label: m.roles_assignableOff() },
                ]}
              />
            ) : (
              <Tag>{(role.assignable ? m.roles_assignableOn : m.roles_assignableOff)()}</Tag>
            )}
          </span>
          <span {...stylex.props(styles.meaning)}>{m.roles_standingMeaning()}</span>
          {editable && (
            <span
              data-testid="role-removal"
              data-deletable={!role.everGranted}
              {...stylex.props(styles.removal)}
            >
              {/* a role anybody was ever granted, withdrawn or not, only
                  goes by being switched off; once it is, there is nothing
                  left to point at */}
              {role.everGranted && (
                <span
                  data-testid="role-removal-why"
                  data-suggests={role.status === 'disabled' ? 'nothing' : 'disable'}
                  {...stylex.props(styles.removalWhy)}
                >
                  {(role.status === 'disabled'
                    ? m.roles_grantedBeforeDisabled
                    : m.roles_grantedBefore)()}
                </span>
              )}
              <Button
                size="xs"
                variant="outline"
                disabled={role.everGranted}
                onClick={() => setConfirmingDelete(true)}
              >
                {m.roles_delete()}
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
            label: m.roles_factHolders(),
            value:
              role.grantCount === 0
                ? m.roles_nobody()
                : m.roles_holderCount({ count: role.grantCount }),
          },
          {
            label: m.roles_columnHolders(),
            value: holderWord === '' ? m.roles_unset() : holderWord,
          },
          ...(role.kind === 'org'
            ? [
                {
                  label: m.roles_columnAnchors(),
                  value: orgWord === '' ? m.roles_unset() : orgWord,
                },
              ]
            : []),
          {
            label: m.roles_tabAppointment(),
            value: locked ? m.roles_every() : appoints === '' ? m.roles_nobody() : appoints,
          },
          {
            label: m.roles_tabPermissions(),
            value: role.holdsEveryPermission
              ? m.roles_every()
              : m.roles_countItems({ count: role.permissions.length }),
          },
        ]}
      />

      <Card data-testid="role-config" data-tab={tab}>
        <div {...stylex.props(styles.tabsRow)}>
          <Tabs
            value={tab}
            onValueChange={(next) => {
              // what is unsaved on the tab being left is asked about rather
              // than kept silently behind a tab nobody is looking at
              if (tabDirty) setLeaving(next as Tab)
              else setTab(next as Tab)
            }}
          >
            <TabsList xstyle={styles.tabList}>
              <TabsTrigger value="permissions" xstyle={styles.tab}>
                {m.roles_tabPermissions()}
                {!role.holdsEveryPermission && (
                  <span {...stylex.props(styles.tabCount)}>
                    {m.roles_pickedOf({ picked: permissions.length, total: catalogTotal })}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="eligibility" xstyle={styles.tab}>
                {m.roles_tabEligibility()}
              </TabsTrigger>
              {!locked && (
                <TabsTrigger value="appointment" xstyle={styles.tab}>
                  {m.roles_tabAppointment()}
                </TabsTrigger>
              )}
              <TabsTrigger value="holders" xstyle={styles.tab}>
                {m.roles_factHolders()}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {tab === 'permissions' &&
          (role.holdsEveryPermission ? (
            <CardEmpty>{m.roles_everyPermission()}</CardEmpty>
          ) : (
            <AsyncSection
              pending={catalog.isPending}
              error={catalog.isError ? describe.of(catalog.error) : null}
              retrying={catalog.isFetching}
              loadingLabel={commonMessages.state_loading()}
              retryLabel={commonMessages.action_retry()}
              onRetry={() => void catalog.refetch()}
            >
              <div {...stylex.props(styles.toolbar)}>
                <SearchField
                  value={search}
                  onChange={setSearch}
                  label={m.roles_searchPermissions()}
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
                    {(allShownPicked ? m.action_selectNone : m.action_selectAll)()}
                  </button>
                )}
                <span {...stylex.props(styles.spacer)} />
                <span {...stylex.props(styles.toolbarNote)}>
                  {(role.kind === 'org' ? m.roles_catalogOrgOnly : m.roles_catalogTenantOnly)()}
                </span>
              </div>
              {groups.length === 0 ? (
                <CardEmpty>{m.roles_searchEmpty()}</CardEmpty>
              ) : (
                groups.map((group) => (
                  <div
                    key={group.title}
                    {...stylex.props(styles.group)}
                    data-testid="permission-group"
                  >
                    <span {...stylex.props(styles.groupHead)}>
                      <span {...stylex.props(styles.groupTitle)}>{group.title}</span>
                      <span {...stylex.props(styles.groupCount)}>
                        {m.roles_pickedOf({
                          picked: group.items.filter((item) => permissions.includes(item.code))
                            .length,
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
                    {m.roles_memberLine({
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
                    {m.action_discard()}
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
                      savePermissions.mutate(undefined)
                    }}
                  >
                    {m.roles_savePermissions()}
                  </Button>
                </CardFoot>
              )}
            </AsyncSection>
          ))}

        {tab === 'eligibility' && locked && <CardEmpty>{m.roles_exemptHint()}</CardEmpty>}
        {tab === 'eligibility' && !locked && (
          <AsyncSection
            pending={options.isPending}
            error={options.isError ? describe.of(options.error) : null}
            retrying={options.isFetching}
            loadingLabel={commonMessages.state_loading()}
            retryLabel={commonMessages.action_retry()}
            onRetry={() => void options.refetch()}
          >
            {/* the mode first, and the list only when it is the mode: an
                empty allow-list means nobody, which is a different rule from
                anybody */}
            <div {...stylex.props(styles.part)}>
              <div {...stylex.props(styles.partHead)}>
                <span {...stylex.props(styles.partTitle)}>{m.field_allowedUserTypes()}</span>
              </div>
              <div {...stylex.props(styles.partBody)}>
                <ModeCards
                  label={m.field_allowedUserTypes()}
                  value={holderMode}
                  disabled={!editable}
                  onChange={setHolderMode}
                  options={[
                    {
                      value: 'unrestricted',
                      title: m.roles_eligibilityAnyone(),
                      body: m.field_eligibilityAnyoneBody(),
                    },
                    {
                      value: 'allow-list',
                      title: m.roles_eligibilityListed(),
                      body: m.field_eligibilityListedBody(),
                    },
                  ]}
                />
              </div>
              {holderMode === 'allow-list' ? (
                <TickGrid columns={3} label={m.field_allowedUserTypes()}>
                  {(options.data?.userTypes ?? []).map((type) => (
                    <Tick
                      key={type.id}
                      label={type.name}
                      checked={userTypeIds.includes(type.id)}
                      disabled={!editable}
                      onChange={(next) =>
                        setUserTypeIds(
                          next
                            ? [...userTypeIds, type.id]
                            : userTypeIds.filter((id) => id !== type.id),
                        )
                      }
                    />
                  ))}
                </TickGrid>
              ) : null}
            </div>

            {role.kind === 'org' && (
              <div {...stylex.props(styles.part)}>
                <div {...stylex.props(styles.partHead)}>
                  <span {...stylex.props(styles.partTitle)}>{m.field_allowedOrgTypes()}</span>
                </div>
                <div {...stylex.props(styles.partBody)}>
                  <ModeCards
                    label={m.field_allowedOrgTypes()}
                    value={anchorMode}
                    disabled={!editable}
                    onChange={setAnchorMode}
                    options={[
                      {
                        value: 'unrestricted',
                        title: m.roles_anchorAnywhere(),
                        body: m.field_anchorAnywhereBody(),
                      },
                      {
                        value: 'allow-list',
                        title: m.roles_anchorListed(),
                        body: m.field_anchorListedBody(),
                      },
                    ]}
                  />
                </div>
                {anchorMode === 'allow-list' ? (
                  <TickGrid columns={3} label={m.field_allowedOrgTypes()}>
                    {(options.data?.orgTypes ?? []).map((type) => (
                      <Tick
                        key={type.id}
                        label={type.name}
                        checked={orgTypeIds.includes(type.id)}
                        disabled={!editable}
                        onChange={(next) =>
                          setOrgTypeIds(
                            next
                              ? [...orgTypeIds, type.id]
                              : orgTypeIds.filter((id) => id !== type.id),
                          )
                        }
                      />
                    ))}
                  </TickGrid>
                ) : null}
              </div>
            )}

            {editable && (
              <CardFoot inset>
                {eligibilityDirty && <UnsavedMark>{m.state_unsaved()}</UnsavedMark>}
                <Spacer />
                <Button variant="ghost" size="sm" disabled={!eligibilityDirty} onClick={seed}>
                  {m.action_discard()}
                </Button>
                <Button
                  size="sm"
                  disabled={!eligibilityDirty || saveEligibility.isPending}
                  onClick={() => saveEligibility.mutate(undefined)}
                >
                  {m.action_save()}
                </Button>
              </CardFoot>
            )}
          </AsyncSection>
        )}

        {/* which offices this one appoints: the WHAT of granting, beside
            iam.grant.manage's WHERE. Nothing ticked means it appoints nobody. */}
        {tab === 'holders' && <RoleHolders roleId={role.id} />}
        {tab === 'appointment' && !locked && (
          <AsyncSection
            pending={allRoles.isPending || grantable.isPending}
            error={
              allRoles.isError
                ? describe.of(allRoles.error)
                : grantable.isError
                  ? describe.of(grantable.error)
                  : null
            }
            retrying={allRoles.isFetching || grantable.isFetching}
            loadingLabel={commonMessages.state_loading()}
            retryLabel={commonMessages.action_retry()}
            onRetry={() => {
              void allRoles.refetch()
              void grantable.refetch()
            }}
          >
            {permissions.includes(
              role.kind === 'tenant' ? 'iam.tenant-grant.manage' : 'iam.grant.manage',
            ) ? (
              <>
                <TickGrid columns={3} label={m.roles_grantableLegend()}>
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
                <CardHint>{m.roles_grantableHint()}</CardHint>
                {editable && (
                  <CardFoot inset>
                    {grantableDirty && <UnsavedMark>{m.state_unsaved()}</UnsavedMark>}
                    <Spacer />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!grantableDirty}
                      onClick={() => setGrantableIds([...(grantable.data?.roleIds ?? [])])}
                    >
                      {m.action_discard()}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!grantableDirty || saveGrantable.isPending}
                      onClick={() => saveGrantable.mutate(undefined)}
                    >
                      {m.action_save()}
                    </Button>
                  </CardFoot>
                )}
              </>
            ) : (
              <CardEmpty>{m.roles_grantableNeedsManage()}</CardEmpty>
            )}
          </AsyncSection>
        )}
      </Card>

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
              form="rename-role"
              disabled={saveProfile.isPending || name.trim() === ''}
            >
              {m.action_save()}
            </Button>
          </>
        }
      >
        <Feedback message={renameRefusal?.taken === false ? renameRefusal.said : null} />
        <form
          id="rename-role"
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
        open={confirmingPermissions}
        title={m.roles_confirmPermissionsTitle()}
        description={m.roles_confirmPermissionsBody({
          holders: role.grantCount,
          appointers: grantable.data?.appointedBy.length ?? 0,
        })}
        confirmLabel={m.action_save()}
        cancelLabel={m.action_cancel()}
        pending={savePermissions.isPending}
        onConfirm={() => savePermissions.mutate(undefined)}
        onCancel={() => setConfirmingPermissions(false)}
      />

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
      <ConfirmDialog
        open={standing !== null}
        {...(standing !== null && 'status' in standing && standing.status === 'disabled'
          ? { tone: 'destructive' as const }
          : {})}
        title={(standing === null
          ? m.roles_askOn
          : 'status' in standing
            ? standing.status === 'active'
              ? m.roles_askOn
              : m.roles_askOff
            : standing.assignable
              ? m.roles_askGrantable
              : m.roles_askNotGrantable)({ name: role.name })}
        description={
          standing !== null && 'status' in standing
            ? m.roles_askStatusBody({ count: role.grantCount })
            : m.roles_askGrantBody()
        }
        confirmLabel={m.action_confirm()}
        cancelLabel={m.action_cancel()}
        pending={setStatus.isPending || setAssignable.isPending}
        onCancel={() => setStanding(null)}
        onConfirm={() => {
          const asked = standing
          setStanding(null)
          if (asked === null) return
          if ('status' in asked) setStatus.mutate(asked.status)
          else setAssignable.mutate(asked.assignable)
        }}
      />

      <FormDialog
        open={leaving !== null}
        title={m.roles_leaveTabTitle()}
        description={m.roles_leaveTabBody()}
        onClose={() => setLeaving(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setLeaving(null)}>
              {m.action_cancel()}
            </Button>
            <Button
              variant="outline"
              data-testid="leave-discard"
              onClick={() => {
                const next = leaving
                setLeaving(null)
                discardTab()
                if (next !== null) setTab(next)
              }}
            >
              {m.action_discard()}
            </Button>
            <Button
              data-testid="leave-save"
              onClick={() => {
                const next = leaving
                setLeaving(null)
                if (next !== null) saveTabThen(next)
              }}
            >
              {m.action_save()}
            </Button>
          </>
        }
      >
        {null}
      </FormDialog>
    </Screen>
  )
}
