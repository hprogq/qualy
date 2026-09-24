import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import type { ApiResult } from '@qualy/web-runtime/api'
import {
  useApi,
  useApiQuery,
  usePageHref,
  useRunApi,
  useSessionTransition,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, ConfirmDialog } from '@qualy/ui/admin'
import { Alert, AlertTitle } from '@qualy/ui/alert'
import {
  Card,
  CardEmpty,
  Cell,
  TableSkeleton,
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
import { instantWords } from '../when.ts'

// How the reader can sign in: every way in that is open to them, what it
// knows them by, and the accounts they bound themselves - which are theirs
// to let go, as long as another way in remains, and theirs to bind where a
// way in takes one. Binding leaves for the other side and comes back here,
// with the reason in the address when it did not work.

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
  const [searchParams] = useSearchParams()
  const here = usePageHref('auth/account-logins')
  // only something shaped like a code is read from the address
  const failure = searchParams.get('error')
  const failed = failure !== null && /^[A-Z][A-Z0-9_]{2,63}$/.test(failure) ? failure : undefined
  const found = useQuery(query.self.listSelfEntrances.queryOptions())
  const self = useQuery(query.self.getSelf.queryOptions())
  const entrances = found.data?.entrances ?? []
  const when = (iso: string) => instantWords(locale, iso)

  /** off to the other side, to come back to this page */
  const bind = (entrance: Entrance) => {
    const target = new URL(entrance.bindHref!, window.location.origin)
    if (here !== undefined) target.searchParams.set('returnTo', here)
    // a document navigation by design: the start route answers with a
    // redirect to the other side
    window.location.assign(`${target.pathname}${target.search}`)
  }

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
      {failed !== undefined && (
        <Alert variant="destructive" data-testid="account-failure" data-code={failed}>
          <AlertTitle>{formatError({ _tag: failed })}</AlertTitle>
        </Alert>
      )}
      <AsyncSection
        pending={found.isPending || self.isPending}
        error={
          found.isError ? formatError(found.error) : self.isError ? formatError(self.error) : null
        }
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => {
          void found.refetch()
          void self.refetch()
        }}
        skeleton={
          <Card>
            <TableSkeleton rows={3} />
          </Card>
        }
      >
        <Card data-testid="account-entrances">
          {entrances.length === 0 ? (
            <CardEmpty>{format(m.accountLoginsEmpty)}</CardEmpty>
          ) : (
            <Table columns="minmax(0, 1fr) minmax(0, 1.4fr) 9.5rem 7rem">
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
                    data-bindable={entrance.bindHref !== null}
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
                    {entrance.lastSignInAt !== null ? (
                      <Cell numeric>{when(entrance.lastSignInAt)}</Cell>
                    ) : bound !== null || entrance.resolution?.mode === 'user-field' ? (
                      <Cell tone="quiet">{format(m.neverUsed)}</Cell>
                    ) : (
                      <Cell />
                    )}
                    {/* the way to act on it: at the end of the row, and on a phone
                        opposite the name rather than among the facts */}
                    <Cell narrow="end">
                      <span {...stylex.props(styles.end)}>
                        {entrance.bindHref !== null && (
                          <Button size="xs" variant="ghost" onClick={() => bind(entrance)}>
                            {format(m.accountBind)}
                          </Button>
                        )}
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
                    </Cell>
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
        description={format(m.accountUnbindBody, {
          current: releasing?.thisSession === true ? 'yes' : 'no',
        })}
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
