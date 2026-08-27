import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useEffect, useState } from 'react'
import { useApi, useRunApi, useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import {
  DefRow,
  EditorHead,
  ModeChoice,
  PickGrid,
  Rail,
  RailRow,
  SaveBar,
  Screen,
  RailSkeleton,
  EditorSkeleton,
  Blank,
} from '@qualy/ui/screen'
import { DoorOpenIcon } from 'lucide-react'
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
const styles = stylex.create({
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  frame: {
    display: 'grid',
    alignItems: 'start',
    gap: 24,
    gridTemplateColumns: { default: null, '@media (min-width: 1024px)': '19rem minmax(0, 1fr)' },
  },
  column: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 16 },
  panel: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 12 },
  alert: { fontSize: 14, lineHeight: '1.25rem', color: tokens.danger },
  code: { fontFamily: 'var(--font-mono, monospace)', fontSize: 12, lineHeight: '1rem' },
  codeHint: {
    marginLeft: 8,
    fontSize: 12,
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  figure: { fontVariantNumeric: 'tabular-nums' },
})

export default function LoginMethodsPage() {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [selected, setSelected] = usePageQueryState('provider')
  const [feedback, setFeedback] = useState<string | null>(null)

  const providers = useQuery(query.identity.listAuthProviders.queryOptions())
  const types = useQuery(query.identity.listUserTypes.queryOptions())
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: query.identity.key() }),
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
          <p {...stylex.props(styles.quiet)}>{format(m.loginMethodsEmpty)}</p>
        ) : (
          <div {...stylex.props(styles.frame)}>
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
              <Blank
                icon={<DoorOpenIcon />}
                title={format(m.pickProviderTitle)}
                description={format(m.pickProviderBody)}
              />
            ) : (
              <div {...stylex.props(styles.column)}>
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

                <div {...stylex.props(styles.panel)}>
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
                    <p {...stylex.props(styles.alert)} data-audience="empty">
                      {format(m.audienceNobody)}
                    </p>
                  )}
                </div>

                <DefRow label={format(m.providerCodeLabel)}>
                  <span {...stylex.props(styles.code)}>{current.code}</span>
                  <span {...stylex.props(styles.codeHint)}>{format(m.providerCodeHint)}</span>
                </DefRow>
                <DefRow label={format(m.providerOrderLabel)}>
                  <span {...stylex.props(styles.figure)}>{current.sortOrder}</span>
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
