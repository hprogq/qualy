import type { Effect } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ChevronLeftIcon, KeyRoundIcon } from 'lucide-react'
import { PageLink, useApi, useRunApi, useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import { Blank, EditorSkeleton, SectionHead, Segmented } from '@qualy/ui/screen'
import { PageContainer } from '@qualy/ui/page-container'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Stagger } from '@qualy/ui/reveal'
import { initialsOf } from '@qualy/ui/person'
import { iamMessages as m } from '../i18n.ts'
import { NodePicker } from './NodePicker.tsx'
import { UserGrants } from './UserGrants.tsx'
import { authApi } from '../api.ts'

// One person, in full. The header carries who they are and the three things
// worth doing to them; the tabs carry the two questions somebody arrives
// with - can they get in, and what have they been given.
//
// The id comes from the route, typed by the page reference that declared the
// `:userId` segment.

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  backSeat: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  backGlyph: {
    width: 14,
    height: 14,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  // who somebody is, before what may be done to them
  headBand: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingBottom: 20,
  },
  portrait: {
    width: 48,
    height: 48,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
  },
  portraitFace: {
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  headText: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  headName: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: '1.125rem',
    lineHeight: '1.75rem',
    fontWeight: 600,
  },
  headMeta: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  metaNo: {
    fontVariantNumeric: 'tabular-nums',
  },
  metaPath: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pinned: {
    flexShrink: 0,
  },
  headActions: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  tabBody: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
  },
  manageLink: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    textDecoration: {
      default: 'none',
      ':hover': 'underline',
    },
  },
  compactBlank: {
    minHeight: '14rem',
  },
  entranceList: {
    minWidth: 0,
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  entranceRow: {
    display: 'grid',
    minWidth: 0,
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 16,
    paddingInline: 16,
    paddingBlock: 12,
  },
  // the hairline between rows is index state: the stagger wraps each row,
  // so there is no usable first-child to key a divider on
  entranceRowDivided: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  entranceWho: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  entranceName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  entranceId: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: '0.75rem',
    color: tokens.mutedForeground,
  },
  entranceWhen: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  alert: {
    color: tokens.danger,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  fullField: {
    width: '100%',
  },
})
export default function UserDetailPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [tab, setTab] = useState<'identities' | 'roles'>('identities')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [confirmingDisable, setConfirmingDisable] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [businessNo, setBusinessNo] = useState('')
  const [userTypeId, setUserTypeId] = useState('')
  const [placement, setPlacement] = useState('')

  const user = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  const record = user.data?.user

  // a different person is a different form, so the draft re-seeds when the
  // record changes or when a save brings back new server state
  useEffect(() => {
    if (!record) return
    setDisplayName(record.displayName)
    setBusinessNo(record.businessNo ?? '')
    setUserTypeId(record.userType?.id ?? '')
    setPlacement(record.primaryOrgNode?.id ?? '')
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
    onSuccess: async () => {
      setSaved(true)
      await refresh()
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
        },
      }),
    ),
    onSuccess: async () => {
      setEditing(false)
      setSaved(true)
      await refresh()
    },
  })
  const transfer = useMutation({
    ...run(() =>
      api.identity.setUserPlacement({
        params: { userId },
        payload: { primaryOrgNodeId: placement, version: record?.version ?? 1 },
      }),
    ),
    onSuccess: async () => {
      setMoving(false)
      setSaved(true)
      await refresh()
    },
  })
  const setStatus = useMutation({
    ...run((status: 'active' | 'disabled' | 'deleted') =>
      api.identity.setUserStatus({
        params: { userId },
        payload: { status, version: record?.version ?? 1 },
      }),
    ),
    onSuccess: async () => {
      setConfirmingDisable(false)
      setConfirmingDelete(false)
      setSaved(true)
      await refresh()
    },
  })

  const manageable = record?.manageable ?? false
  const nodes = options.data?.nodes ?? []
  const userTypes = options.data?.userTypes ?? []
  const identities = user.data?.identities ?? []

  return (
    <PageContainer size="default" xstyle={styles.page}>
      <p {...stylex.props(styles.backSeat)}>
        <PageLink page="auth/users" className={stylex.props(styles.backLink).className}>
          <ChevronLeftIcon className={stylex.props(styles.backGlyph).className} aria-hidden />
          {format(m.backToUsers)}
        </PageLink>
      </p>

      <AsyncSection
        pending={user.isPending}
        error={user.isError ? formatError(user.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void user.refetch()}
        skeleton={<EditorSkeleton />}
      >
        {record && (
          <div {...stylex.props(styles.body)}>
            <div {...stylex.props(styles.headBand)}>
              <Avatar className={stylex.props(styles.portrait).className}>
                <AvatarFallback className={stylex.props(styles.portraitFace).className}>
                  {initialsOf(record.displayName)}
                </AvatarFallback>
              </Avatar>
              <div {...stylex.props(styles.headText)}>
                <p {...stylex.props(styles.headName)}>
                  {record.displayName}
                  {record.status === 'deleted' ? (
                    <Badge variant="outline">{format(m.deletedBadge)}</Badge>
                  ) : record.status === 'disabled' ? (
                    <Badge variant="destructive">{format(m.disabledBadge)}</Badge>
                  ) : (
                    <Badge variant="secondary">{format(m.statusActive)}</Badge>
                  )}
                </p>
                <p {...stylex.props(styles.headMeta)}>
                  {record.businessNo && (
                    <span {...stylex.props(styles.metaNo)}>{record.businessNo}</span>
                  )}
                  <span>{record.userType?.name ?? '—'}</span>
                  <span {...stylex.props(styles.metaPath)}>
                    {(user.data?.orgPath ?? []).map((node) => node.name).join(' / ')}
                  </span>
                </p>
              </div>
              {record.status === 'deleted' ? (
                // what comes back is the person, disabled: access is a
                // second, explicit act
                <Button
                  variant="outline"
                  size="sm"
                  className={stylex.props(styles.pinned).className}
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('disabled')}
                >
                  {format(m.restoreAction)}
                </Button>
              ) : (
                manageable && (
                  <div {...stylex.props(styles.headActions)}>
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                      {format(m.editProfile)}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setMoving(true)}>
                      {format(m.moveLabel)}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        record.status === 'active'
                          ? setConfirmingDisable(true)
                          : setStatus.mutate('active')
                      }
                    >
                      {format(record.status === 'active' ? m.disable : m.enable)}
                    </Button>
                    {record.status === 'disabled' && (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() => setConfirmingDelete(true)}
                      >
                        {format(m.deleteAction)}
                      </Button>
                    )}
                  </div>
                )
              )}
            </div>

            <Feedback message={feedback} />
            {saved && feedback === null && <Feedback message={format(m.saved)} tone="success" />}

            <Segmented
              label={format(m.userDetailTitle)}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'identities', label: format(m.profileTabIdentities) },
                { value: 'roles', label: format(m.profileTabRoles) },
              ]}
            />

            {tab === 'identities' && (
              <div {...stylex.props(styles.tabBody)}>
                <SectionHead
                  title={format(m.boundHeading)}
                  count={format(m.boundCount, { count: identities.length })}
                  actions={
                    <PageLink
                      page="auth/login-methods"
                      className={stylex.props(styles.manageLink).className}
                      unavailable={null}
                    >
                      {format(m.manageWaysIn)}
                    </PageLink>
                  }
                />
                {identities.length === 0 ? (
                  <Blank
                    icon={<KeyRoundIcon />}
                    title={format(m.boundEmptyTitle)}
                    description={format(m.boundEmptyBody)}
                    xstyle={styles.compactBlank}
                  />
                ) : (
                  <Stagger className={stylex.props(styles.entranceList).className}>
                    {identities.map((identity, at) => (
                      <div
                        key={identity.id}
                        data-entrance-status={identity.providerStatus}
                        {...stylex.props(styles.entranceRow, at > 0 && styles.entranceRowDivided)}
                      >
                        <span {...stylex.props(styles.entranceWho)}>
                          <span {...stylex.props(styles.entranceName)}>
                            {identity.providerName}
                          </span>
                          <Badge
                            variant="secondary"
                            className={stylex.props(styles.pinned).className}
                          >
                            {format(identity.hasCredential ? m.localAccount : m.federatedAccount)}
                          </Badge>
                          {identity.providerStatus === 'disabled' && (
                            <Badge
                              variant="destructive"
                              className={stylex.props(styles.pinned).className}
                            >
                              {format(m.entranceDisabled)}
                            </Badge>
                          )}
                        </span>
                        <span {...stylex.props(styles.entranceId)}>{identity.identifier}</span>
                        <span
                          {...stylex.props(
                            styles.entranceWhen,
                            identity.lastUsedAt === null && styles.alert,
                          )}
                        >
                          {identity.lastUsedAt === null
                            ? format(m.neverUsed)
                            : format(m.lastUsed, {
                                when: new Date(identity.lastUsedAt).toLocaleDateString(),
                              })}
                        </span>
                      </div>
                    ))}
                  </Stagger>
                )}
              </div>
            )}

            {tab === 'roles' && <UserGrants userId={userId} nodes={nodes} />}

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
                  saveProfile.mutate(undefined as never)
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
                <Field label={format(m.businessNoLabel)}>
                  {(id) => (
                    <Input
                      id={id}
                      value={businessNo}
                      onChange={(event) => setBusinessNo(event.target.value)}
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

            <FormDialog
              open={moving}
              title={format(m.moveLabel)}
              onClose={() => setMoving(false)}
              footer={
                <>
                  <Button variant="outline" onClick={() => setMoving(false)}>
                    {format(m.cancel)}
                  </Button>
                  <Button
                    disabled={transfer.isPending || placement === record.primaryOrgNode?.id}
                    onClick={() => transfer.mutate(undefined as never)}
                  >
                    {format(m.moveAction)}
                  </Button>
                </>
              }
            >
              <Field label={format(m.anchorLabel)}>
                {(id) => (
                  <NodePicker
                    id={id}
                    label={format(m.anchorLabel)}
                    nodes={nodes}
                    value={placement}
                    onChange={setPlacement}
                    placeholder={format(m.movePick)}
                  />
                )}
              </Field>
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
              pending={setStatus.isPending}
              onConfirm={() => setStatus.mutate('deleted')}
              onCancel={() => setConfirmingDelete(false)}
            />
          </div>
        )}
      </AsyncSection>
    </PageContainer>
  )
}
