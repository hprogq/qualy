import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import type { ApiResult } from '@qualy/web-runtime/api'
import {
  PageLink,
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageHref,
  useRunApi,
  useSessionTransition,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'

import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog } from '@qualy/ui/admin'
import { XIcon } from 'lucide-react'
import { Alert, AlertAction, AlertTitle } from '@qualy/ui/alert'
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

import { authApi } from '../api.ts'
import { EntranceAccount } from '../iam/person-facts.tsx'
import { instantWords } from '../when.ts'
import { useReauthentication } from './Reauthentication.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
  quiet: { fontSize: 12, color: tokens.mutedForeground },
})

export default function AccountLoginsPage() {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const endSession = useSessionTransition()
  const { formatError, locale } = useI18n()
  const describe = useLoadFailure()
  const [releasing, setReleasing] = useState<Entrance | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const here = usePageHref('auth/account-logins')
  // where the reader sets their own address, when this assembly has the page
  const securityHref = usePageHref('auth/account-security')
  // another way in is one for whoever holds the session: they show it is them first
  const reauthentication = useReauthentication(here)
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
      <SectionHead title={m.account_logins()} />
      {failed !== undefined && (
        // what came back from the other side, until the reader has read it:
        // put away, it leaves the address too, so a reload does not say it again
        <Alert variant="destructive" data-testid="account-failure" data-code={failed}>
          <AlertTitle>{formatError({ _tag: failed })}</AlertTitle>
          <AlertAction>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={commonMessages.action_close()}
              onClick={() =>
                setSearchParams(
                  (current) => {
                    const next = new URLSearchParams(current)
                    next.delete('error')
                    return next
                  },
                  { replace: true },
                )
              }
            >
              <XIcon aria-hidden />
            </Button>
          </AlertAction>
        </Alert>
      )}
      <AsyncSection
        pending={found.isPending || self.isPending}
        error={
          found.isError ? describe.of(found.error) : self.isError ? describe.of(self.error) : null
        }
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
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
            <CardEmpty>{m.account_loginsEmpty()}</CardEmpty>
          ) : (
            <Table columns="minmax(0, 1fr) minmax(0, 1.4fr) 9.5rem 7rem">
              <TableHead>
                <span>{m.loginMethods_title()}</span>
                <span>{m.person_columnAccount()}</span>
                <span>{m.person_columnLastUsed()}</span>
                <span />
              </TableHead>
              {entrances.map((entrance) => {
                const bound = entrance.bound
                // a door that finds the reader by a field they do not have yet
                const missing =
                  entrance.resolution?.mode === 'user-field' &&
                  (entrance.resolution.field === 'email'
                    ? self.data?.email == null
                    : self.data?.businessNo == null)
                    ? entrance.resolution.field
                    : null
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
                      unbound={m.account_notBound()}
                    />
                    {entrance.lastSignInAt !== null ? (
                      <Cell numeric>{when(entrance.lastSignInAt)}</Cell>
                    ) : bound !== null || entrance.resolution?.mode === 'user-field' ? (
                      <Cell tone="quiet">{m.person_neverUsed()}</Cell>
                    ) : (
                      <Cell />
                    )}
                    {/* the way to act on it: at the end of the row, and on a phone
                        opposite the name rather than among the facts */}
                    <Cell narrow="end">
                      <span {...stylex.props(styles.end)}>
                        {/* the reader sets their own address on the security
                            page; their number is the directory's to give */}
                        {missing === 'email' && securityHref !== undefined && (
                          <Button size="xs" variant="ghost" asChild>
                            <PageLink page="auth/account-security">{m.account_goSet()}</PageLink>
                          </Button>
                        )}
                        {missing === 'businessNo' && (
                          <span {...stylex.props(styles.quiet)}>
                            {m.account_askAdministrator()}
                          </span>
                        )}
                        {entrance.bindHref !== null && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => reauthentication.ensure(() => bind(entrance))}
                          >
                            {m.account_bind()}
                          </Button>
                        )}
                        {entrance.unbindable && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={release.isPending}
                            onClick={() => setReleasing(entrance)}
                          >
                            {m.account_unbind()}
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

      {reauthentication.dialog}
      <ConfirmDialog
        open={releasing !== null}
        tone="destructive"
        title={m.account_unbindTitle({ name: releasing?.name ?? '' })}
        description={m.account_unbindBody({
          current: releasing?.thisSession === true ? 'yes' : 'no',
        })}
        confirmLabel={m.account_unbind()}
        cancelLabel={m.action_cancel()}
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
