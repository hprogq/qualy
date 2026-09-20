import type { ApiResult } from '@qualy/web-runtime/api'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Feedback, Field } from '@qualy/ui/admin'
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
import { MethodFields, type EntranceKind } from './MethodFields.tsx'

// One entrance, opened beside the table.
//
// What an administrator owns about an entrance: what it is called, whether
// it is in service, who it lets through, and whatever its kind needs to be
// told. Where it answers is fixed when it is made - it is in every sign-in
// link - and where it stands on the sign-in page is set by dragging it in
// the list, not by typing a number here.

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
  figure: { fontVariantNumeric: 'tabular-nums' },
  warn: { color: tokens.warningForeground },
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
  onClose,
}: {
  open: boolean
  provider: ProviderRow
  /** where it stands on the sign-in page, counted from one */
  position: number
  userTypes: readonly UserTypeRow[]
  /** what its kind needs to be told; absent when its driver declares nothing */
  kind: EntranceKind | undefined
  canManage: boolean
  onClose: () => void
}) {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()
  const figure = new Intl.NumberFormat(locale)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string> | null>(null)
  // the draft is kept only while it differs from what is stored, so a save
  // that brings back new server state needs no re-seeding
  const [draft, setDraft] = useState<{ mode: Mode; userTypeIds: string[] } | null>(null)
  const stored = storedOf(provider)
  const mode = draft?.mode ?? provider.audience.mode
  const userTypeIds = draft?.userTypeIds ?? stored
  const dirty =
    mode !== provider.audience.mode ||
    [...userTypeIds].sort().join(',') !== [...stored].sort().join(',')

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
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      setDraft(null)
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: query.identity.key() })
  const saveDetails = useMutation({
    mutationFn: () =>
      runApi(
        api.identity.updateAuthProvider({
          params: { providerId: provider.id },
          payload: {
            version: provider.version,
            ...(name === null || name.trim() === provider.name ? {} : { name: name.trim() }),
            ...(values === null ? {} : { values }),
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await refresh()
      setName(null)
      setValues(null)
    },
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
  const detailsDirty =
    (name !== null && name.trim() !== '' && name.trim() !== provider.name) || values !== null

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      title={provider.name}
      titleAside={<Tag outline>{provider.type}</Tag>}
      meta={
        <MetaLine items={[format(m.loginMethodsTitle), format(m.providerPosition, { position })]} />
      }
      closeLabel={format(commonMessages.close)}
      testId="method-sheet"
    >
      <Feedback message={feedback} />

      <Card data-testid="audience-panel" data-mode={mode} data-count={userTypeIds.length}>
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
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {format(m.save)}
            </Button>
          </CardFoot>
        )}
      </Card>

      <Card data-testid="method-details" data-status={provider.status}>
        <CardHead title={format(m.methodDetails)}>
          {canManage ? (
            <Segmented
              label={format(m.columnStatus)}
              value={provider.status}
              onChange={(next) => {
                if (next !== provider.status && !setStatus.isPending) setStatus.mutate(next)
              }}
              options={[
                { value: 'active', label: format(m.typeEnabled) },
                { value: 'disabled', label: format(m.statusDisabled) },
              ]}
            />
          ) : (
            <span {...stylex.props(styles.modeWord)}>
              {format(provider.status === 'active' ? m.typeEnabled : m.statusDisabled)}
            </span>
          )}
        </CardHead>
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
              editing
              disabled={!canManage}
              values={values ?? {}}
              onChange={setValues}
            />
          )}
        </div>
        <DefList>
          <DefLine label={format(m.providerKindLabel)}>{provider.type}</DefLine>
          <DefLine label={format(m.providerCodeLabel)}>
            <span {...stylex.props(styles.code)}>{provider.code}</span>
            <span {...stylex.props(styles.aside)}>{format(m.providerCodeHint)}</span>
          </DefLine>
          <DefLine label={format(m.providerOrderLabel)}>
            <span {...stylex.props(styles.figure)}>{position}</span>
            <span {...stylex.props(styles.aside)}>{format(m.methodOrderHint)}</span>
          </DefLine>
        </DefList>
        {canManage && (
          <CardFoot inset>
            {detailsDirty && <UnsavedMark>{format(m.unsaved)}</UnsavedMark>}
            <Spacer />
            <Button
              size="sm"
              variant="ghost"
              disabled={!detailsDirty || saveDetails.isPending}
              onClick={() => {
                setName(null)
                setValues(null)
              }}
            >
              {format(m.discard)}
            </Button>
            <Button
              size="sm"
              disabled={!detailsDirty || saveDetails.isPending}
              onClick={() => saveDetails.mutate()}
            >
              {format(m.save)}
            </Button>
          </CardFoot>
        )}
      </Card>
    </DetailSheet>
  )
}
