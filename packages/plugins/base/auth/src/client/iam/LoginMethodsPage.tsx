import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useApi, useRunApi, useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import {
  Blocker,
  DefRow,
  EditorHead,
  ModeChoice,
  PickGrid,
  Rail,
  RailRow,
  SaveBar,
  Screen,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// The tenant's doors, and who each one lets through.
//
// The audience lives on the door rather than on the user type, because that
// is where the question is actually decided: "can a student sign in" has no
// answer until you say through which entrance. Nothing here creates or
// removes a door - a door is a driver the assembly provides, and the only
// thing an administrator owns about it is its audience.
export default function LoginMethodsPage() {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const orpc = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [selected, setSelected] = usePageQueryState('provider')
  const [feedback, setFeedback] = useState<string | null>(null)

  const providers = useQuery(orpc.identity.listAuthProviders.queryOptions())
  const types = useQuery(orpc.identity.listUserTypes.queryOptions())
  const rows = providers.data?.providers ?? []
  const current = rows.find((provider) => provider.id === selected)

  const stored =
    current?.audience.mode === 'allow-list' ? [...current.audience.userTypeIds] : ([] as string[])
  const [mode, setMode] = useState<'unrestricted' | 'allow-list'>('unrestricted')
  const [userTypeIds, setUserTypeIds] = useState<string[]>([])
  // a different door is a different form, so the draft re-seeds when the
  // selection changes or when a save brings back new server state
  useEffect(() => {
    setMode(current?.audience.mode ?? 'unrestricted')
    setUserTypeIds(current?.audience.mode === 'allow-list' ? [...current.audience.userTypeIds] : [])
    setFeedback(null)
  }, [current])

  const save = useMutation({
    mutationFn: () =>
      runApi(
        api.identity.setAuthProviderAudience({
          params: { providerId: current!.id },
          payload: {
            // the version this editor read: a save that cannot say what it
            // saw is a save that silently overwrites whoever went second
            version: current!.version,
            audience:
              mode === 'unrestricted'
                ? { mode: 'unrestricted' }
                : { mode: 'allow-list', userTypeIds },
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.identity.key() }),
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  const named = (ids: readonly string[]) =>
    (types.data?.userTypes ?? [])
      .filter((type) => ids.includes(type.id))
      .map((type) => type.name)
      .join('、')
  const dirty =
    mode !== (current?.audience.mode ?? 'unrestricted') ||
    [...userTypeIds].sort().join(',') !== [...stored].sort().join(',')
  const canManage = types.data?.capabilities.canManage ?? false

  return (
    <Screen title={format(m.loginMethodsTitle)} description={format(m.loginMethodsHint)}>
      <AsyncSection
        pending={providers.isPending}
        error={providers.isError ? formatError(providers.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void providers.refetch()}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{format(m.loginMethodsEmpty)}</p>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
            <Rail>
              {rows.map((provider) => (
                <RailRow
                  key={provider.id}
                  name={provider.name}
                  badges={[
                    { label: provider.type, tone: 'quiet' },
                    ...(provider.status === 'disabled'
                      ? [{ label: format(m.statusDisabled), tone: 'alert' as const }]
                      : []),
                  ]}
                  meta={[
                    provider.audience.mode === 'unrestricted'
                      ? { text: format(m.audienceEveryone) }
                      : {
                          text: format(m.audienceSummary, {
                            count: provider.audience.userTypeIds.length,
                          }),
                          ...(provider.audience.userTypeIds.length === 0
                            ? { tone: 'alert' as const }
                            : {}),
                        },
                  ]}
                  selected={provider.id === selected}
                  onSelect={() => setSelected(provider.id === selected ? '' : provider.id)}
                />
              ))}
            </Rail>

            {current === undefined ? (
              <p className="text-sm text-muted-foreground">{format(m.loginMethodSelectHint)}</p>
            ) : (
              <div className="flex min-w-0 flex-col gap-4">
                <EditorHead
                  title={current.name}
                  chips={[
                    { label: current.type },
                    ...(current.status === 'disabled'
                      ? [{ label: format(m.statusDisabled), tone: 'alert' as const }]
                      : []),
                  ]}
                />

                <Feedback message={feedback} />

                <div className="flex min-w-0 flex-col gap-3">
                  <ModeChoice
                    legend={format(m.audienceLegend)}
                    value={mode}
                    onChange={setMode}
                    disabled={!canManage}
                    options={[
                      { value: 'unrestricted', label: format(m.audienceAnyone) },
                      { value: 'allow-list', label: format(m.audienceListed) },
                    ]}
                    {...(dirty ? { hint: format(m.unsaved) } : {})}
                  />
                  {mode === 'allow-list' && (
                    <PickGrid
                      legend={format(m.audienceLegend)}
                      emptyLabel={format(m.noOptions)}
                      disabled={!canManage}
                      options={(types.data?.userTypes ?? []).map((type) => ({
                        value: type.id,
                        label: type.name,
                        tally: format(m.userCount, { count: type.userCount }),
                      }))}
                      selected={userTypeIds}
                      onChange={setUserTypeIds}
                    />
                  )}
                  {/* an allow-list naming nobody is a door that opens for
                      nobody; that is a legal rule, and it is said out loud
                      rather than refused */}
                  {mode === 'allow-list' && userTypeIds.length === 0 && (
                    <Blocker standing="open">{format(m.audienceNobody)}</Blocker>
                  )}
                </div>

                <DefRow label={format(m.providerCodeLabel)}>
                  <span className="font-mono text-xs">{current.code}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {format(m.providerCodeHint)}
                  </span>
                </DefRow>
                <DefRow label={format(m.providerOrderLabel)}>
                  <span className="tabular-nums">{current.sortOrder}</span>
                </DefRow>

                {canManage && (
                  <SaveBar>
                    {dirty && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setMode(current.audience.mode)
                          setUserTypeIds(stored)
                        }}
                      >
                        {format(m.discard)}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!dirty || save.isPending}
                      onClick={() => save.mutate()}
                    >
                      {format(m.save)}
                    </Button>
                  </SaveBar>
                )}
              </div>
            )}
          </div>
        )}
      </AsyncSection>
    </Screen>
  )
}
