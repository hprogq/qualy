import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import type { ApiResult } from '@qualy/web-runtime/api'
import { useApi, useApiQuery, useRunApi, useSessionTransition } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, ConfirmDialog } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
  Cell,
  EditorSkeleton,
  LeadWord,
  SectionHead,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { toast } from '@qualy/ui/toast'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { EntranceAccount } from '../iam/person-facts.tsx'

// How the reader can sign in: every way in that is open to them, what it
// knows them by, and the accounts they bound themselves - which are theirs
// to let go, as long as another way in remains.

type Entrance = ApiResult<typeof authApi, 'self', 'listSelfEntrances'>['entrances'][number]

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
  end: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 4,
    marginInlineStart: { default: null, [breakpoints.phone]: 'auto' },
  },
})

export default function AccountLoginsPage() {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const endSession = useSessionTransition()
  const { format, formatError, locale } = useI18n()
  const [releasing, setReleasing] = useState<Entrance | null>(null)
  const found = useQuery(query.self.listSelfEntrances.queryOptions())
  const self = useQuery(query.self.getSelf.queryOptions())
  const entrances = found.data?.entrances ?? []
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' })

  const release = useMutation({
    mutationFn: (entrance: Entrance) =>
      run(api.self.deleteSelfAuthBinding({ params: { providerId: entrance.providerId } })),
    onSuccess: async (answer) => {
      // the session this page runs in signed in that way, and is over
      if (answer.signedOut) {
        await endSession({ destination: { kind: 'page', page: 'auth/login' } })
        return
      }
      await queryClient.invalidateQueries({ queryKey: query.self.key() })
    },
    onError: (error: unknown) => toast.error(formatError(error)),
  })

  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead title={format(m.accountLogins)} />
      <AsyncSection
        pending={found.isPending || self.isPending}
        error={
          found.isError
            ? formatError(found.error)
            : self.isError
              ? formatError(self.error)
              : null
        }
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => {
          void found.refetch()
          void self.refetch()
        }}
        skeleton={<EditorSkeleton />}
      >
        <Card data-testid="account-entrances">
          {entrances.length === 0 ? (
            <CardEmpty>{format(m.accountLoginsEmpty)}</CardEmpty>
          ) : (
            <Table columns="minmax(0, 1fr) minmax(0, 1.4fr) 7rem 7rem">
              <TableHead>
                <span>{format(m.loginMethodsTitle)}</span>
                <span>{format(m.columnAccount)}</span>
                <span>{format(m.columnLastUsed)}</span>
                <span />
              </TableHead>
              {entrances.map((entrance) => {
                const bound = entrance.bound
                return (
                  <TableRow
                    key={entrance.providerId}
                    data-testid="account-entrance"
                    data-entrance-type={entrance.type}
                    data-bound={bound !== null}
                    data-unbindable={entrance.unbindable}
                  >
                    <Cell lead>
                      <LeadWord>{entrance.name}</LeadWord>
                    </Cell>
                    <EntranceAccount
                      entrance={entrance}
                      person={{
                        email: self.data?.email ?? null,
                        businessNo: self.data?.businessNo ?? null,
                      }}
                      unbound={format(m.accountNotBound)}
                    />
                    {bound === null ? (
                      <Cell />
                    ) : bound.lastUsedAt === null ? (
                      <Cell tone="quiet">{format(m.neverUsed)}</Cell>
                    ) : (
                      <Cell numeric>{when(bound.lastUsedAt)}</Cell>
                    )}
                    <span {...stylex.props(styles.end)}>
                      {entrance.unbindable && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={release.isPending}
                          onClick={() => setReleasing(entrance)}
                        >
                          {format(m.accountUnbind)}
                        </Button>
                      )}
                    </span>
                  </TableRow>
                )
              })}
            </Table>
          )}
        </Card>
      </AsyncSection>

      <ConfirmDialog
        open={releasing !== null}
        tone="destructive"
        title={format(m.accountUnbindTitle, { name: releasing?.name ?? '' })}
        description={format(m.accountUnbindBody)}
        confirmLabel={format(m.accountUnbind)}
        cancelLabel={format(m.cancel)}
        pending={release.isPending}
        onCancel={() => setReleasing(null)}
        onConfirm={() => {
          const entrance = releasing
          setReleasing(null)
          if (entrance !== null) release.mutate(entrance)
        }}
      />
    </div>
  )
}
