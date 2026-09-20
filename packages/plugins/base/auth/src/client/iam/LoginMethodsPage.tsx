import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageQueryState } from '@qualy/web-runtime'
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
import { authApi } from '../api.ts'

// The tenant's doors, and who each one lets through.
//
// The audience lives on the door rather than on the user type, because that
// is where the question is actually decided: "can a student sign in" has no
// answer until you say through which entrance. Nothing here creates or
// removes a door - a door is a driver the assembly provides, and the only
// thing an administrator owns about it is its audience.

const COLUMNS = 'minmax(0, 0.8fr) 6rem minmax(0, 1.4fr) 6.5rem 4.5rem'

export default function LoginMethodsPage() {
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const listJoin = useList()
  const [selected, setSelected] = usePageQueryState('provider')

  const providers = useQuery(query.identity.listAuthProviders.queryOptions())
  const types = useQuery(query.identity.listUserTypes.queryOptions())
  const rows = providers.data?.providers ?? []
  const userTypes = types.data?.userTypes ?? []
  const open = rows.find((provider) => provider.id === selected)
  const shown = useLingering(open ?? null)
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
        <Card>
          {rows.length === 0 ? (
            <CardEmpty>{format(m.loginMethodsEmpty)}</CardEmpty>
          ) : (
            <Table columns={COLUMNS} openable>
              <TableHead>
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
          canManage={canManage}
          onClose={() => setSelected('')}
        />
      )}
    </Screen>
  )
}
