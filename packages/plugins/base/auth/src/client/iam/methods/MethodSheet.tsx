import type { ApiResult } from '@qualy/web-runtime/api'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { ConfirmDialog, Feedback, Field } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
  CardFoot,
  CardHead,
  CardHint,
  DefLine,
  DefList,
  DetailSheet,
  MetaLine,
  Segmented,
  Spacer,
  Tag,
  Tick,
  TickGrid,
  UnsavedMark,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { iamMessages as m } from '../../i18n.ts'
import { authApi } from '../../api.ts'
import { MethodFields } from './MethodFields.tsx'
import { ShownCard } from './ShownCard.tsx'
import { fieldShown, formValues, type EntranceKind } from './form-values.ts'
import { CheckIcon, CopyIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from '@qualy/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { Alert, AlertDescription, AlertTitle } from '@qualy/ui/alert'

// One entrance, opened beside the table.
//
// What an administrator owns about an entrance: what it is called, whether
// it is in service, who it lets through, whatever its kind needs to be told,
// and whether it exists at all. An entrance goes into service only once it
// has everything its kind needs, and while it is in service nothing it needs
// can be taken away here. Where it answers is fixed when it is made; where it
// stands on the sign-in page is set by dragging it in the list, and how it is
// drawn there, and whether it is the one recommended, on its own card.

export type ProviderRow = ApiResult<
  typeof authApi,
  'identity',
  'listAuthProviders'
>['providers'][number]
type UserTypeRow = ApiResult<typeof authApi, 'identity', 'listUserTypes'>['userTypes'][number]
type Mode = 'unrestricted' | 'allow-list'

const styles = stylex.create({
  modeWord: { fontSize: 12.5, color: tokens.mutedForeground },
  code: {
    fontFamily: "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace",
    fontSize: 12,
  },
  aside: { fontSize: 11.5, color: tokens.mutedForeground },
  callback: { display: 'flex', width: '100%', minWidth: 0, alignItems: 'flex-start', gap: 6 },
  callbackUrl: {
    minWidth: 0,
    flexGrow: 1,
    overflowWrap: 'anywhere',
    wordBreak: 'break-all',
    lineHeight: 1.5,
    paddingTop: 3,
  },
  copyGlyph: { width: 14, height: 14 },
  figure: { fontVariantNumeric: 'tabular-nums' },
  warn: { color: tokens.warningForeground },
  missingSeat: { paddingInline: 16, paddingTop: 14 },
  missing: {
    borderColor: `color-mix(in oklab, ${tokens.warning} 35%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 8%, ${tokens.surface})`,
    color: tokens.warningForeground,
  },
  fields: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    paddingInline: 16,
    paddingBlock: 14,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
})

const storedOf = (provider: ProviderRow): string[] =>
  provider.audience.mode === 'allow-list' ? [...provider.audience.userTypeIds] : []

export function MethodSheet({
  open,
  provider,
  position,
  userTypes,
  kind,
  canManage,
  canManageTrust,
  onClose,
}: {
  open: boolean
  provider: ProviderRow
  /** where it stands on the sign-in page, counted from one */
  position: number
  userTypes: readonly UserTypeRow[]
  /** what its kind needs to be told; absent when its driver declares nothing */
  kind: EntranceKind | undefined
  /** its name, audience, status and deletion */
  canManage: boolean
  /** what it believes: its settings and secrets */
  canManageTrust: boolean
  onClose: () => void
}) {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatText, formatError, locale } = useI18n()
  const listJoin = useList()
  const figure = new Intl.NumberFormat(locale)
  // the kind as its driver names it; its code only where no driver claims it
  const kindWord = provider.kindLabel === null ? provider.type : formatText(provider.kindLabel)
  const detail = useQuery(
    query.identity.getAuthProvider.queryOptions({ params: { providerId: provider.id } }),
  )
  const [feedback, setFeedback] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [asking, setAsking] = useState<'active' | 'disabled' | null>(null)
  const [deleting, setDeleting] = useState(false)
  // saving an audience that signs somebody out is asked about first
  const [narrowing, setNarrowing] = useState(false)
  // only the boxes somebody typed in: an untouched box is not sent
  const [values, setValues] = useState<Record<string, string>>({})
  // the draft is kept only while it differs from what is stored, so a save
  // that brings back new server state needs no re-seeding
  const [draft, setDraft] = useState<{ mode: Mode; userTypeIds: string[] } | null>(null)
  const stored = storedOf(provider)
  const mode = draft?.mode ?? provider.audience.mode
  const userTypeIds = draft?.userTypeIds ?? stored
  const dirty =
    mode !== provider.audience.mode ||
    [...userTypeIds].sort().join(',') !== [...stored].sort().join(',')
  // the sessions the audience as drafted would end: those of the types it
  // would no longer admit
  const ending =
    mode === 'allow-list'
      ? (detail.data?.usage.sessionsByUserType ?? [])
          .filter((row) => !userTypeIds.includes(row.userTypeId))
          .reduce((sum, row) => sum + row.sessions, 0)
      : 0

  const config = detail.data?.config ?? {}
  const secrets = detail.data?.secrets ?? []
  const inService = provider.status === 'active'
  const complete = provider.setup === 'complete'
  const fields = kind?.fields ?? []
  const holds = kind === undefined ? {} : formValues(kind, config, {})
  const willHold = kind === undefined ? {} : formValues(kind, config, values)
  /** the boxes whose value differs from what is stored, as the save sends them */
  const changedValues = Object.fromEntries(
    Object.entries(values).filter(([key, typed]) => {
      const field = fields.find((one) => one.key === key)
      if (field === undefined) return false
      return field.kind === 'secret' ? typed.trim() !== '' : willHold[key] !== holds[key]
    }),
  )
  const valuesDirty = Object.keys(changedValues).length > 0
  // a door in service keeps what it needs: a save that would leave a box it
  // shows empty - emptied, or newly shown by another box - is not offered
  const wouldEmpty =
    inService &&
    valuesDirty &&
    fields.some(
      (field) =>
        field.required &&
        fieldShown(field, willHold) &&
        (field.kind === 'secret'
          ? !(secrets.find((one) => one.key === field.key)?.stored ?? false) &&
            (values[field.key] ?? '').trim() === ''
          : willHold[field.key] === ''),
    )
  const gaps = detail.data?.missing ?? []
  const labelOf = (key: string) => {
    const field = fields.find((one) => one.key === key)
    return field === undefined ? key : formatText(field.label)
  }
  const missingWords = gaps.flatMap((gap) => {
    if (gap.kind === 'driver') return [format(m.methodDriverMissing)]
    if (gap.kind === 'public-origin') return [format(m.methodOriginMissing)]
    if (gap.kind === 'secret-unreadable') return []
    return [labelOf(gap.key)]
  })
  // stored, and no longer decrypting: said apart, because the box is not empty
  const unreadableKeys = gaps.flatMap((gap) => (gap.kind === 'secret-unreadable' ? [gap.key] : []))

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.identity.key() })
  const save = useMutation({
    mutationFn: () =>
      runApi(
        api.identity.setAuthProviderAudience({
          params: { providerId: provider.id },
          payload: {
            // the version this editor read: a save that cannot say what it
            // saw is a save that silently overwrites whoever went second
            version: provider.version,
            audience:
              mode === 'unrestricted'
                ? { mode: 'unrestricted' }
                : { mode: 'allow-list', userTypeIds },
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await refresh()
      setDraft(null)
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const saveDetails = useMutation({
    mutationFn: () =>
      runApi(
        api.identity.updateAuthProvider({
          params: { providerId: provider.id },
          payload: {
            version: provider.version,
            ...(name === null || name.trim() === provider.name ? {} : { name: name.trim() }),
            ...(valuesDirty ? { values: changedValues } : {}),
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await refresh()
      setName(null)
      setValues({})
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })
  const clearSecret = useMutation({
    mutationFn: (key: string) =>
      runApi(
        api.identity.deleteAuthProviderSecret({
          params: { providerId: provider.id, key },
          query: { version: String(provider.version) },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: refresh,
    onError: (error: unknown) => setFeedback(formatError(error)),
  })
  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'disabled') =>
      runApi(
        api.identity.setAuthProviderStatus({
          params: { providerId: provider.id },
          payload: { version: provider.version, status },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: refresh,
    onError: (error: unknown) => setFeedback(formatError(error)),
  })
  const remove = useMutation({
    mutationFn: () =>
      runApi(
        api.identity.deleteAuthProvider({
          params: { providerId: provider.id },
          query: { version: String(provider.version) },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setDeleting(false)
      onClose()
      await refresh()
    },
    onError: (error: unknown) => {
      setDeleting(false)
      setFeedback(formatError(error))
    },
  })
  const nameDirty = name !== null && name.trim() !== '' && name.trim() !== provider.name
  const detailsDirty = nameDirty || valuesDirty
  const statusWord = format(
    inService ? m.typeEnabled : complete ? m.statusDisabled : m.methodSetupShort,
  )

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      title={provider.name}
      titleAside={<Tag outline>{kindWord}</Tag>}
      meta={
        <MetaLine
          items={[
            format(m.loginMethodsTitle),
            format(
              provider.prominence === 'primary' ? m.methodShownPrimary : m.methodShownSecondary,
              { position },
            ),
          ]}
        />
      }
      actions={
        canManage ? (
          // always there for whoever manages the ways in, so a door that may
          // not go says why rather than simply having no way to try
          <DeleteAction
            refusal={provider.isSystem ? format(m.methodDeleteSystem) : null}
            busy={remove.isPending || detail.data === undefined}
            label={format(m.methodDelete)}
            onPress={() => setDeleting(true)}
          />
        ) : undefined
      }
      closeLabel={format(commonMessages.close)}
      testId="method-sheet"
    >
      <Feedback message={feedback} />

      <Card
        data-testid="audience-panel"
        data-mode={mode}
        data-count={userTypeIds.length}
        data-ending={ending}
      >
        <CardHead title={format(m.audienceLegend)}>
          {canManage ? (
            <Segmented
              label={format(m.audienceLegend)}
              value={mode}
              onChange={(next) => setDraft({ mode: next, userTypeIds })}
              options={[
                { value: 'unrestricted', label: format(m.audienceAnyone) },
                { value: 'allow-list', label: format(m.audienceListed) },
              ]}
            />
          ) : (
            <span {...stylex.props(styles.modeWord)}>
              {format(mode === 'unrestricted' ? m.audienceAnyone : m.audienceListed)}
            </span>
          )}
        </CardHead>
        {mode === 'allow-list' &&
          (userTypes.length === 0 ? (
            <CardEmpty>{format(m.noOptions)}</CardEmpty>
          ) : (
            <TickGrid columns={1} label={format(m.audienceLegend)}>
              {userTypes.map((type) => (
                <Tick
                  key={type.id}
                  label={type.name}
                  tally={format(m.peopleTally, { count: figure.format(type.userCount) })}
                  checked={userTypeIds.includes(type.id)}
                  disabled={!canManage}
                  onChange={(next) =>
                    setDraft({
                      mode,
                      userTypeIds: next
                        ? [...userTypeIds, type.id]
                        : userTypeIds.filter((id) => id !== type.id),
                    })
                  }
                />
              ))}
            </TickGrid>
          ))}
        {/* an allow-list naming nobody is a door that opens for nobody; that
            is a legal rule, and it is said out loud rather than refused */}
        <CardHint top={mode !== 'allow-list'}>
          {mode === 'allow-list' && userTypeIds.length === 0 ? (
            <span data-audience="empty" {...stylex.props(styles.warn)}>
              {format(m.audienceNobody)}
            </span>
          ) : (
            format(mode === 'allow-list' ? m.audienceListedHint : m.audienceEveryone)
          )}
        </CardHint>
        {canManage && (
          <CardFoot inset>
            {dirty && <UnsavedMark>{format(m.unsaved)}</UnsavedMark>}
            <Spacer />
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty || save.isPending}
              onClick={() => setDraft(null)}
            >
              {format(m.discard)}
            </Button>
            <Button
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => (ending > 0 ? setNarrowing(true) : save.mutate())}
            >
              {format(m.save)}
            </Button>
          </CardFoot>
        )}
      </Card>

      <Card
        data-testid="method-details"
        data-status={provider.status}
        data-setup={provider.setup}
        data-sessions={detail.data?.usage.sessions ?? 0}
      >
        <CardHead title={format(m.methodDetails)}>
          {/* only a finished entrance can be put in service; an unfinished
              one that is out of service says so instead of offering it */}
          {canManage && (inService || complete) ? (
            <Segmented
              label={format(m.columnStatus)}
              value={provider.status}
              // asked about first: taking a way in out of service locks out
              // everybody who has no other, the moment it lands
              onChange={(next) => {
                if (next !== provider.status && !setStatus.isPending) setAsking(next)
              }}
              options={[
                { value: 'active', label: format(m.typeEnabled) },
                { value: 'disabled', label: format(m.statusDisabled) },
              ]}
            />
          ) : (
            <span {...stylex.props(styles.modeWord)}>{statusWord}</span>
          )}
        </CardHead>
        {missingWords.length > 0 && (
          // what is missing, set apart from the fields it names rather than
          // pressed against the head above them
          <div {...stylex.props(styles.missingSeat)}>
            <Alert xstyle={styles.missing}>
              <TriangleAlertIcon aria-hidden />
              <AlertTitle
                data-testid="method-missing"
                data-missing={gaps
                  .flatMap((gap) =>
                    gap.kind === 'secret-unreadable'
                      ? []
                      : [gap.kind === 'field' ? gap.key : gap.kind],
                  )
                  .join(',')}
              >
                {format(m.methodMissing, { fields: listJoin(missingWords) })}
              </AlertTitle>
              {!inService && <AlertDescription>{format(m.methodEnableBlocked)}</AlertDescription>}
            </Alert>
          </div>
        )}
        {unreadableKeys.length > 0 && (
          <div {...stylex.props(styles.missingSeat)}>
            <Alert xstyle={styles.missing}>
              <TriangleAlertIcon aria-hidden />
              <AlertTitle data-testid="method-unreadable" data-keys={unreadableKeys.join(',')}>
                {format(m.methodUnreadable, { fields: listJoin(unreadableKeys.map(labelOf)) })}
              </AlertTitle>
            </Alert>
          </div>
        )}
        <div {...stylex.props(styles.fields)}>
          <Field label={format(m.nameLabel)}>
            {(id) => (
              <Input
                id={id}
                disabled={!canManage}
                value={name ?? provider.name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          {kind !== undefined && kind.fields.length > 0 && (
            <MethodFields
              kind={kind}
              config={config}
              secrets={secrets}
              draft={values}
              onChange={setValues}
              disabled={!canManageTrust || detail.data === undefined}
              {...(canManageTrust ? { onClear: (key: string) => clearSecret.mutate(key) } : {})}
              // a door in service keeps the secrets it needs
              clearable={(key) =>
                !clearSecret.isPending &&
                !(inService && fields.some((field) => field.key === key && field.required))
              }
            />
          )}
        </div>
        <DefList>
          <DefLine label={format(m.providerKindLabel)}>{kindWord}</DefLine>
          <DefLine label={format(m.providerCodeLabel)}>
            <span {...stylex.props(styles.code)}>{provider.code}</span>
            <span {...stylex.props(styles.aside)}>{format(m.providerCodeHint)}</span>
          </DefLine>
          {detail.data?.callbackUrl != null && (
            <DefLine label={format(m.methodCallback)}>
              {/* an address is one long word: it breaks wherever it has to
                  rather than running out of the sheet, and is copied whole */}
              <span {...stylex.props(styles.callback)}>
                <span
                  data-testid="method-callback"
                  {...stylex.props(styles.code, styles.callbackUrl)}
                >
                  {detail.data.callbackUrl}
                </span>
                <CopyButton value={detail.data.callbackUrl} label={format(m.methodCallbackCopy)} />
              </span>
              <span {...stylex.props(styles.aside)}>{format(m.methodCallbackHint)}</span>
            </DefLine>
          )}
        </DefList>
        {(canManage || canManageTrust) && (
          <CardFoot inset>
            {detailsDirty && <UnsavedMark>{format(m.unsaved)}</UnsavedMark>}
            <Spacer />
            <Button
              size="sm"
              variant="ghost"
              disabled={!detailsDirty || saveDetails.isPending}
              onClick={() => {
                setName(null)
                setValues({})
              }}
            >
              {format(m.discard)}
            </Button>
            <Button
              size="sm"
              disabled={!detailsDirty || wouldEmpty || saveDetails.isPending}
              onClick={() => saveDetails.mutate()}
            >
              {format(m.save)}
            </Button>
          </CardFoot>
        )}
      </Card>
      <ShownCard provider={provider} position={position} canManage={canManage} />

      <ConfirmDialog
        open={asking !== null}
        {...(asking === 'disabled' ? { tone: 'destructive' as const } : {})}
        title={format(asking === 'disabled' ? m.methodDisableTitle : m.methodEnableTitle, {
          name: provider.name,
        })}
        description={
          asking === 'disabled'
            ? format(m.methodDisableBody, { sessions: detail.data?.usage.sessions ?? 0 })
            : format(m.methodEnableBody)
        }
        confirmLabel={format(asking === 'disabled' ? m.disable : m.enable)}
        cancelLabel={format(m.cancel)}
        pending={setStatus.isPending}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const next = asking
          setAsking(null)
          if (next !== null) setStatus.mutate(next)
        }}
      />
      <ConfirmDialog
        open={narrowing}
        tone="destructive"
        title={format(m.audienceNarrowTitle)}
        description={format(m.audienceNarrowBody, { sessions: ending })}
        confirmLabel={format(m.save)}
        cancelLabel={format(m.cancel)}
        pending={save.isPending}
        onCancel={() => setNarrowing(false)}
        onConfirm={() => {
          setNarrowing(false)
          save.mutate()
        }}
      />
      <ConfirmDialog
        open={deleting}
        tone="destructive"
        title={format(m.methodDeleteTitle, { name: provider.name })}
        description={format(m.methodDeleteBody, {
          bindings: detail.data?.usage.bindings ?? 0,
          sessions: detail.data?.usage.sessions ?? 0,
        })}
        confirmLabel={format(m.methodDelete)}
        cancelLabel={format(m.cancel)}
        pending={remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />
    </DetailSheet>
  )
}

/** the way to delete a door, or the reason there is none, said on hover and focus */
function DeleteAction({
  refusal,
  busy,
  label,
  onPress,
}: {
  refusal: string | null
  busy: boolean
  label: string
  onPress: () => void
}) {
  const button = (
    <Button
      size="xs"
      variant="ghost"
      data-testid="method-delete"
      disabled={refusal !== null || busy}
      onClick={onPress}
    >
      {label}
    </Button>
  )
  if (refusal === null) return button
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* a disabled button hears no pointer, so the seat around it does */}
          <span tabIndex={0} data-testid="method-delete-refused">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{refusal}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** a value copied whole with one press, and saying so */
function CopyButton({ value, label }: { value: string; label: string }) {
  const { format } = useI18n()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const back = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(back)
  }, [copied])
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      title={label}
      data-testid="copy-value"
      data-copied={copied}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true)
            toast.success(format(m.copied))
          },
          () => toast.error(format(m.copyFailed)),
        )
      }}
    >
      {copied ? (
        <CheckIcon aria-hidden {...stylex.props(styles.copyGlyph)} />
      ) : (
        <CopyIcon aria-hidden {...stylex.props(styles.copyGlyph)} />
      )}
    </Button>
  )
}
