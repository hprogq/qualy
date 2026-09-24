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
import { PasswordChecklist } from '../password/PasswordChecklist.tsx'
import { usePasswordChecks } from '../password/checks.ts'
import { EntranceAccount } from './person-facts.tsx'
import { instantWords } from '../when.ts'

// How one person gets in, as somebody administering them reads it.
//
// Every door of the tenant is a row, because the question is "how could they
// sign in" and a door with nothing bound is half of the answer. How a door
// finds the person and what may be written for them is the door's own say,
// carried from the server: a door that goes by a field of theirs shows that
// field, read off the person; a credential an administrator manages gets a
// password form; an account only the person can bind gets a sentence. This
// screen knows none of the kinds by name.

type Entrance = ApiResult<typeof authApi, 'identity', 'listUserEntrances'>['entrances'][number]

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
})

export default function UserIdentitiesPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()
  const entrancesHref = usePageHref('auth/login-methods')
  const [editing, setEditing] = useState<Entrance | null>(null)
  const [revoking, setRevoking] = useState<Entrance | null>(null)

  const found = useQuery(query.identity.listUserEntrances.queryOptions({ params: { userId } }))
  // the fields a door may find the person by are the person's own
  const person = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const entrances = found.data?.entrances ?? []
  const manageable = found.data?.manageable ?? false
  const record = person.data?.user
  const when = (iso: string) => instantWords(locale, iso)

  const revoke = useMutation({
    mutationFn: (entrance: Entrance) =>
      run(
        api.identity.deleteUserAuthBinding({ params: { userId, providerId: entrance.providerId } }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
    },
    onError: (error: unknown) => toast.error(formatError(error)),
  })

  /** the value of the person's own field a door finds them by, if they have it */
  const fieldValue = (field: 'email' | 'businessNo') =>
    field === 'email' ? (record?.email ?? null) : (record?.businessNo ?? null)

  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead
        title={format(m.identitiesSection)}
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
        pending={found.isPending || person.isPending}
        error={
          found.isError
            ? formatError(found.error)
            : person.isError
              ? formatError(person.error)
              : null
        }
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => {
          void found.refetch()
          void person.refetch()
        }}
        skeleton={<EditorSkeleton />}
      >
        <Card data-testid="entrances">
          {entrances.length === 0 ? (
            <CardEmpty>{format(m.loginMethodsEmpty)}</CardEmpty>
          ) : (
            <Table columns="minmax(0, 1fr) minmax(0, 1.4fr) 9.5rem 9rem">
              <TableHead>
                <span>{format(m.loginMethodsTitle)}</span>
                <span>{format(m.columnAccount)}</span>
                <span>{format(m.columnLastUsed)}</span>
                <span />
              </TableHead>
              {entrances.map((entrance) => {
                const bound = entrance.bound
                const resolution = entrance.resolution
                // a credential can only be set for somebody the door can find
                const settable =
                  manageable &&
                  entrance.admits &&
                  entrance.binding?.mode === 'managed' &&
                  resolution?.mode === 'user-field' &&
                  fieldValue(resolution.field) !== null
                return (
                  <TableRow
                    key={entrance.providerId}
                    data-testid="entrance-row"
                    data-entrance-type={entrance.type}
                    data-entrance-status={entrance.status}
                    data-resolution={
                      resolution === null
                        ? 'none'
                        : resolution.mode === 'user-field'
                          ? `user-field:${resolution.field}`
                          : resolution.mode
                    }
                    data-binding={entrance.binding?.mode ?? 'none'}
                    data-bound={bound !== null}
                    data-credential={bound?.hasCredential === true ? 'set' : 'unset'}
                    data-admits={entrance.admits}
                  >
                    <Cell lead>
                      {/* the name is the door; the driver's own code is ours,
                          not the reader's, and stays on the row as data for
                          whoever is debugging */}
                      <LeadWord>{entrance.name}</LeadWord>
                      {entrance.status === 'disabled' && (
                        <Status tone="bad">{format(m.entranceDisabled)}</Status>
                      )}
                    </Cell>
                    <EntranceAccount
                      entrance={entrance}
                      person={{
                        email: record?.email ?? null,
                        businessNo: record?.businessNo ?? null,
                      }}
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
                        {settable && (
                          <Button size="xs" variant="ghost" onClick={() => setEditing(entrance)}>
                            {format(
                              bound?.hasCredential === true ? m.passwordReset : m.passwordSet,
                            )}
                          </Button>
                        )}
                        {manageable && bound !== null && (
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
                    </Cell>
                  </TableRow>
                )
              })}
            </Table>
          )}
        </Card>
      </AsyncSection>

      {editing !== null && (
        <PasswordDialog
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

/** the one thing an administrator types for a credential they manage */
function PasswordDialog({
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
  const [secret, setSecret] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  // said in red once a press found something wrong, for as long as it is
  const [refused, setRefused] = useState(false)
  const checks = usePasswordChecks({
    password: secret,
    min: binding?.secret.minLength ?? 0,
    max: binding?.secret.maxLength ?? Number.POSITIVE_INFINITY,
    scope: ['binding', userId, entrance.providerId],
    assess: (typed) =>
      run(
        api.identity.createUserAuthBindingAssessment({
          params: { userId, providerId: entrance.providerId },
          payload: { secret: typed },
        }),
      ).then((answer) => answer.checks),
  })

  const save = useMutation({
    mutationFn: () =>
      run(
        api.identity.putUserAuthBinding({
          params: { userId, providerId: entrance.providerId },
          payload: { secret },
        }),
      ),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      toast.success(format(m.saved))
      onClose()
    },
    onError: (error: unknown) => {
      // a refused secret is said by the list under it
      if ((error as { _tag?: unknown })._tag === 'AUTH_BINDING_CREDENTIAL_INVALID') setRefused(true)
      else setFeedback(formatError(error))
    },
  })

  if (binding === null) return null
  const replacing = entrance.bound?.hasCredential === true

  return (
    <FormDialog
      open
      title={format(m.passwordDialogTitle, { name: entrance.name })}
      {...(replacing ? { description: format(m.identityResetBody) } : {})}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {format(m.cancel)}
          </Button>
          <Button type="submit" form="user-auth-binding" disabled={secret === '' || save.isPending}>
            {format(m.save)}
          </Button>
        </>
      }
    >
      <form
        id="user-auth-binding"
        {...stylex.props(styles.form)}
        onSubmit={(event) => {
          event.preventDefault()
          if (!checks.passable) {
            setRefused(true)
            return
          }
          save.mutate()
        }}
      >
        <Feedback message={feedback} />
        <Field
          label={formatText(binding.secret.label)}
          {...(binding.secret.hint === null ? {} : { hint: formatText(binding.secret.hint) })}
        >
          {(id) => (
            <Input
              id={id}
              name="binding-secret"
              type="password"
              // never the browser's saved one: this is somebody else's account
              autoComplete="new-password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          )}
        </Field>
        <PasswordChecklist
          checks={checks}
          password={secret}
          min={binding.secret.minLength}
          refused={refused}
        />
      </form>
    </FormDialog>
  )
}
