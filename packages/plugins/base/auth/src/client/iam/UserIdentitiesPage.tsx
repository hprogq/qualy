import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import type { ApiResult } from '@qualy/web-runtime/api'
import {
  PageLink,
  useApi,
  useApiQuery,
  usePageHref,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, ConfirmDialog, Feedback, Field, FormDialog } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
  CardHint,
  Cell,
  EditorSkeleton,
  LeadWord,
  SectionHead,
  Status,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { toast } from '@qualy/ui/toast'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// How one person gets in, as somebody administering them reads it.
//
// Every entrance of the tenant is a row, bound or not, because the question
// is "how could they sign in" and an entrance with nothing bound is half of
// the answer. What can be done about a row is the entrance's own say, carried
// from the server: a kind of account an administrator may write gets a form
// made of the fields its driver asked for; one only the person can make, or
// one that goes by a fact they already have, gets a sentence instead of a
// control. This screen knows none of the kinds by name.

type Entrance = ApiResult<
  typeof authApi,
  'identity',
  'listUserEntrances'
>['entrances'][number]

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
  manageLink: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    textDecoration: 'none',
  },
  end: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 4,
    marginInlineStart: { default: null, [breakpoints.phone]: 'auto' },
  },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  code: { fontFamily: "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace", fontSize: 12 },
})

export default function UserIdentitiesPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatText, formatError, locale } = useI18n()
  const entrancesHref = usePageHref('auth/login-methods')
  const [editing, setEditing] = useState<Entrance | null>(null)
  const [revoking, setRevoking] = useState<Entrance | null>(null)

  const found = useQuery(query.identity.listUserEntrances.queryOptions({ params: { userId } }))
  const entrances = found.data?.entrances ?? []
  const manageable = found.data?.manageable ?? false
  const bound = entrances.filter((entrance) => entrance.identity !== null).length
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' })

  const revoke = useMutation({
    mutationFn: (entrance: Entrance) =>
      run(api.identity.deleteUserIdentity({ params: { userId, providerId: entrance.providerId } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
    },
    onError: (error: unknown) => toast.error(formatError(error)),
  })

  /** what stands in the account column when nothing is bound */
  const unbound = (entrance: Entrance) => {
    if (!entrance.admits) return <Cell tone="quiet">{format(m.entranceNotAdmitted)}</Cell>
    if (entrance.binding?.mode === 'derived') {
      return (
        <Cell tone="quiet">
          {format(m.entranceDerived, { by: formatText(entrance.binding.by) })}
        </Cell>
      )
    }
    if (entrance.binding?.mode === 'self') {
      return <Cell tone="quiet">{format(m.entranceSelf)}</Cell>
    }
    if (entrance.binding?.mode === 'managed') {
      return (
        <Cell tone="warn">
          <Status tone="warn">{format(m.entranceUnbound)}</Status>
        </Cell>
      )
    }
    return <Cell tone="quiet">{format(m.entranceUnbound)}</Cell>
  }

  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead
        title={format(m.identitiesSection)}
        count={found.data === undefined ? undefined : format(m.boundCount, { count: bound })}
        actions={
          entrancesHref !== undefined && (
            <PageLink
              page="auth/login-methods"
              className={stylex.props(styles.manageLink).className}
            >
              {format(m.manageWaysIn)}
            </PageLink>
          )
        }
      />
      <AsyncSection
        pending={found.isPending}
        error={found.isError ? formatError(found.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void found.refetch()}
        skeleton={<EditorSkeleton />}
      >
        <Card data-testid="entrances" data-bound={bound}>
          {entrances.length === 0 ? (
            <CardEmpty>{format(m.loginMethodsEmpty)}</CardEmpty>
          ) : (
            <Table columns="minmax(0, 1fr) minmax(0, 1.2fr) 7rem 9rem">
              <TableHead>
                <span>{format(m.loginMethodsTitle)}</span>
                <span>{format(m.columnAccount)}</span>
                <span>{format(m.columnLastUsed)}</span>
                <span />
              </TableHead>
              {entrances.map((entrance) => {
                const identity = entrance.identity
                const writable = manageable && entrance.binding?.mode === 'managed'
                return (
                  <TableRow
                    key={entrance.providerId}
                    data-testid="entrance-row"
                    data-entrance-type={entrance.type}
                    data-entrance-status={entrance.status}
                    data-binding={entrance.binding?.mode ?? 'none'}
                    data-bound={identity !== null}
                    data-admits={entrance.admits}
                  >
                    <Cell lead>
                      {/* the name is the entrance; the driver's own code is
                          ours, not the reader's, and stays on the row as
                          data for whoever is debugging */}
                      <LeadWord>{entrance.name}</LeadWord>
                      {entrance.status === 'disabled' && (
                        <Status tone="bad">{format(m.entranceDisabled)}</Status>
                      )}
                    </Cell>
                    {identity === null ? (
                      unbound(entrance)
                    ) : (
                      <Cell tone="plain" title={identity.identifier}>
                        <span {...stylex.props(styles.code)}>{identity.identifier}</span>
                      </Cell>
                    )}
                    {identity === null ? (
                      <Cell />
                    ) : identity.lastUsedAt === null ? (
                      <Cell tone="warn">{format(m.neverUsed)}</Cell>
                    ) : (
                      <Cell numeric>{when(identity.lastUsedAt)}</Cell>
                    )}
                    <span {...stylex.props(styles.end)}>
                      {writable && entrance.admits && (
                        <Button size="xs" variant="ghost" onClick={() => setEditing(entrance)}>
                          {format(identity === null ? m.identityAdd : m.identityReset)}
                        </Button>
                      )}
                      {manageable && identity !== null && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={revoke.isPending && revoke.variables === entrance}
                          onClick={() => setRevoking(entrance)}
                        >
                          {format(m.identityRevoke)}
                        </Button>
                      )}
                    </span>
                  </TableRow>
                )
              })}
            </Table>
          )}
          {entrances.length > 0 && bound === 0 && (
            <CardHint top>{format(m.boundEmptyBody)}</CardHint>
          )}
        </Card>
      </AsyncSection>

      {editing !== null && (
        <IdentityDialog
          key={editing.providerId}
          userId={userId}
          entrance={editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={revoking !== null}
        tone="destructive"
        title={format(m.identityRevokeTitle)}
        description={format(m.identityRevokeBody)}
        confirmLabel={format(m.identityRevoke)}
        cancelLabel={format(m.cancel)}
        pending={revoke.isPending}
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          const entrance = revoking
          setRevoking(null)
          if (entrance !== null) revoke.mutate(entrance)
        }}
      />
    </div>
  )
}

/** the fields one kind of entrance asked for, and nothing this screen decided */
function IdentityDialog({
  userId,
  entrance,
  onClose,
}: {
  userId: string
  entrance: Entrance
  onClose: () => void
}) {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatText, formatError } = useI18n()
  const binding = entrance.binding?.mode === 'managed' ? entrance.binding : null
  const [identifier, setIdentifier] = useState(entrance.identity?.identifier ?? '')
  const [secret, setSecret] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      run(
        api.identity.putUserIdentity({
          params: { userId, providerId: entrance.providerId },
          payload: {
            identifier: identifier.trim(),
            ...(binding?.secret == null ? {} : { secret }),
          },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      toast.success(format(m.saved))
      onClose()
    },
    onError: (error: unknown) => setFeedback(formatError(error)),
  })

  if (binding === null) return null
  const replacing = entrance.identity !== null
  const ready =
    identifier.trim() !== '' && (binding.secret === null || secret.length >= binding.secret.minLength)

  return (
    <FormDialog
      open
      title={format(replacing ? m.identityResetTitle : m.identityAddTitle, { name: entrance.name })}
      {...(replacing ? { description: format(m.identityResetBody) } : {})}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button type="submit" form="user-identity" disabled={!ready || save.isPending}>
            {format(m.save)}
          </Button>
        </>
      }
    >
      <form
        id="user-identity"
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) save.mutate()
        }}
      >
        <Feedback message={feedback} />
        <Field
          label={formatText(binding.identifierLabel)}
          {...(binding.identifierHint === null ? {} : { hint: formatText(binding.identifierHint) })}
        >
          {(id) => (
            <Input
              id={id}
              name="identity-identifier"
              autoComplete="off"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          )}
        </Field>
        {binding.secret !== null && (
          <Field
            label={formatText(binding.secret.label)}
            hint={format(m.identitySecretHint, { count: binding.secret.minLength })}
          >
            {(id) => (
              <Input
                id={id}
                name="identity-secret"
                type="password"
                // never the browser's saved one: this is somebody else's account
                autoComplete="new-password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            )}
          </Field>
        )}
      </form>
    </FormDialog>
  )
}
