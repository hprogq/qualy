import type { ApiResult } from '@qualy/web-runtime/api'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Feedback } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
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
import { iamMessages as m } from '../../i18n.ts'
import { authApi } from '../../api.ts'

// One entrance, opened beside the table.
//
// The only thing an administrator owns about an entrance is who it lets
// through; what kind it is, where it answers and where it stands on the
// sign-in page come from the assembly and are read here, not edited.

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
})

const storedOf = (provider: ProviderRow): string[] =>
  provider.audience.mode === 'allow-list' ? [...provider.audience.userTypeIds] : []

export function MethodSheet({
  open,
  provider,
  position,
  userTypes,
  canManage,
  onClose,
}: {
  open: boolean
  provider: ProviderRow
  /** where it stands on the sign-in page, counted from one */
  position: number
  userTypes: readonly UserTypeRow[]
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
      footer={
        canManage ? (
          <>
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
          </>
        ) : undefined
      }
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
      </Card>

      <Card>
        <DefList>
          <DefLine label={format(m.providerKindLabel)}>{provider.type}</DefLine>
          <DefLine label={format(m.providerCodeLabel)}>
            <span {...stylex.props(styles.code)}>{provider.code}</span>
            <span {...stylex.props(styles.aside)}>{format(m.providerCodeHint)}</span>
          </DefLine>
          <DefLine label={format(m.providerOrderLabel)}>
            <span {...stylex.props(styles.figure)}>{position}</span>
          </DefLine>
        </DefList>
      </Card>
    </DetailSheet>
  )
}
