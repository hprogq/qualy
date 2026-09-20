import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { GripVerticalIcon, PlusIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { useApi, useApiQuery, usePageQueryState, useRunApi } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { useLingering } from '@qualy/ui/use-lingering'
import {
  Card,
  CardEmpty,
  Cell,
  LeadWord,
  Screen,
  Status,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { iamMessages as m } from '../i18n.ts'
import { MethodSheet } from './methods/MethodSheet.tsx'
import { NewMethodDialog } from './methods/NewMethodDialog.tsx'
import { authApi } from '../api.ts'

// The tenant's doors, and who each one lets through.
//
// The audience lives on the door rather than on the user type, because that
// is where the question is actually decided: "can a student sign in" has no
// answer until you say through which entrance. Nothing here creates or
// removes a door - a door is a driver the assembly provides, and the only
// thing an administrator owns about it is its audience.

const COLUMNS = '1.5rem minmax(0, 0.8fr) 6rem minmax(0, 1.4fr) 6.5rem 4.5rem'

const styles = stylex.create({
  // the handle a row is moved by: the order of this list IS the order of the
  // sign-in page, so it is set by putting rows where they belong
  grip: {
    display: 'inline-flex',
    width: 20,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    borderRadius: 5,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: tokens.mutedForeground,
    cursor: 'grab',
  },
  gripGlyph: { width: 14, height: 14 },
  over: { boxShadow: `inset 0 2px 0 ${tokens.foreground}` },
  lifted: { opacity: 0.45 },
})

export default function LoginMethodsPage() {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const listJoin = useList()
  const [selected, setSelected] = usePageQueryState('provider')

  const api = useApi(authApi)
  const runApi = useRunApi()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [lifted, setLifted] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const providers = useQuery(query.identity.listAuthProviders.queryOptions())
  const kinds = useQuery({ ...query.identity.listAuthProviderKinds.queryOptions(), retry: false })
  const types = useQuery(query.identity.listUserTypes.queryOptions())
  const rows = providers.data?.providers ?? []
  const userTypes = types.data?.userTypes ?? []
  const open = rows.find((provider) => provider.id === selected)
  const shown = useLingering(open ?? null)
  const canManage = types.data?.capabilities.canManage ?? false
  const reorder = useMutation({
    mutationFn: (providerIds: string[]) =>
      runApi(api.identity.setAuthProviderOrder({ payload: { providerIds } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: query.identity.key() }),
    onError: (error: unknown) => toast.error(formatError(error)),
  })
  /** the list with one row taken out and put back in front of another */
  const placed = (moving: string, before: string) => {
    const ids = rows.map((row) => row.id).filter((id) => id !== moving)
    ids.splice(ids.indexOf(before), 0, moving)
    return ids
  }
  const step = (id: string, by: 1 | -1) => {
    const ids = rows.map((row) => row.id)
    const at = ids.indexOf(id)
    const to = at + by
    if (to < 0 || to >= ids.length) return
    ;[ids[at], ids[to]] = [ids[to]!, ids[at]!]
    reorder.mutate(ids)
  }

  return (
    <Screen
      title={format(m.loginMethodsTitle)}
      description={format(m.loginMethodsHint)}
      actions={
        canManage &&
        (kinds.data?.kinds.length ?? 0) > 0 && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden />
            {format(m.methodNew)}
          </Button>
        )
      }
    >
      <AsyncSection
        pending={providers.isPending}
        error={providers.isError ? formatError(providers.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void providers.refetch()}
      >
        <Card>
          {rows.length === 0 ? (
            <CardEmpty>{format(m.loginMethodsEmpty)}</CardEmpty>
          ) : (
            <Table columns={COLUMNS} openable>
              <TableHead>
                <span />
                <span>{format(m.loginMethodsTitle)}</span>
                <span>{format(m.providerKindLabel)}</span>
                <span>{format(m.audienceLegend)}</span>
                <span>{format(m.providerOrderLabel)}</span>
                <span>{format(m.columnStatus)}</span>
              </TableHead>
              {rows.map((provider, index) => {
                const nobody =
                  provider.audience.mode === 'allow-list' &&
                  provider.audience.userTypeIds.length === 0
                return (
                  <TableRow
                    key={provider.id}
                    nested
                    xstyle={[over === provider.id && styles.over, lifted === provider.id && styles.lifted]}
                    onDragOver={(event) => {
                      if (lifted === null || lifted === provider.id) return
                      event.preventDefault()
                      setOver(provider.id)
                    }}
                    onDragLeave={() => setOver((now) => (now === provider.id ? null : now))}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (lifted !== null && lifted !== provider.id) {
                        reorder.mutate(placed(lifted, provider.id))
                      }
                      setLifted(null)
                      setOver(null)
                    }}
                    onOpen={() => setSelected(provider.id)}
                    selected={provider.id === open?.id}
                    data-testid="method-row"
                    data-status={provider.status}
                    data-audience={
                      provider.audience.mode === 'unrestricted'
                        ? 'everyone'
                        : String(provider.audience.userTypeIds.length)
                    }
                  >
                    {canManage ? (
                      <button
                        type="button"
                        draggable
                        aria-label={format(m.methodMove, { name: provider.name })}
                        data-testid="method-grip"
                        {...stylex.props(styles.grip)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', provider.id)
                          setLifted(provider.id)
                        }}
                        onDragEnd={() => {
                          setLifted(null)
                          setOver(null)
                        }}
                        // the same move without a pointer
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowUp') step(provider.id, -1)
                          else if (event.key === 'ArrowDown') step(provider.id, 1)
                          else return
                          event.preventDefault()
                        }}
                      >
                        <GripVerticalIcon aria-hidden {...stylex.props(styles.gripGlyph)} />
                      </button>
                    ) : (
                      <span />
                    )}
                    <Cell lead>
                      <LeadWord>{provider.name}</LeadWord>
                    </Cell>
                    <Cell tone="muted">{provider.type}</Cell>
                    <Cell tone={nobody ? 'warn' : 'muted'}>
                      {provider.audience.mode === 'unrestricted' ? (
                        format(m.audienceEveryone)
                      ) : nobody ? (
                        <Status tone="warn">{format(m.audienceSummary, { count: 0 })}</Status>
                      ) : (
                        listJoin(
                          userTypes
                            .filter(
                              (type) =>
                                provider.audience.mode === 'allow-list' &&
                                provider.audience.userTypeIds.includes(type.id),
                            )
                            .map((type) => type.name),
                        )
                      )}
                    </Cell>
                    <Cell tone="muted" numeric>
                      {index + 1}
                    </Cell>
                    <Cell tone="muted">
                      <Status tone={provider.status === 'active' ? 'plain' : 'bad'}>
                        {format(provider.status === 'active' ? m.typeEnabled : m.statusDisabled)}
                      </Status>
                    </Cell>
                  </TableRow>
                )
              })}
            </Table>
          )}
        </Card>
      </AsyncSection>

      {shown !== null && (
        <MethodSheet
          key={shown.id}
          open={open !== undefined}
          provider={shown}
          position={rows.findIndex((provider) => provider.id === shown.id) + 1}
          userTypes={userTypes}
          kind={kinds.data?.kinds.find((kind) => kind.type === shown.type)}
          canManage={canManage}
          onClose={() => setSelected('')}
        />
      )}
      <NewMethodDialog
        open={creating}
        kinds={kinds.data?.kinds ?? []}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          setSelected(id)
        }}
      />
    </Screen>
  )
}
