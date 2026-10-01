import { assertNever, useLocale } from '@qualy/web-i18n'

import {
  useRunApi,
  useApiMutation,
  PageLink,
  useApi,
  useApiQuery,
  usePageHref,
  usePageRouteParams,
  useLoadFailure,
} from '@qualy/web-runtime'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { type ApiResult } from '@qualy/web-runtime/api'

import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
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

import { authApi } from '../api.ts'
import { needsReauthentication, useReauthentication } from '../account/Reauthentication.tsx'
import { PasswordChecklist } from '../password/PasswordChecklist.tsx'
import { usePasswordChecks } from '../password/checks.ts'
import { EntranceAccount } from './person-facts.tsx'
import { AccountFieldDialog } from './users/AccountFieldDialog.tsx'
import { instantWords } from '../when.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const locale = useLocale()
  // a reading of this section that failed; the person not being there is the banner's to say
  const describe = useLoadFailure()
  const entrancesHref = usePageHref('auth/login-methods')
  const [editing, setEditing] = useState<Entrance | null>(null)
  const [revoking, setRevoking] = useState<Entrance | null>(null)
  // a field a door finds the person by, being filled in where it was missing
  const [filling, setFilling] = useState<'email' | 'businessNo' | null>(null)
  const businessNoWord = useTerm(authTerms.businessNumber)

  const found = useQuery(query.identity.listUserEntrances.queryOptions({ params: { userId } }))
  // the fields a door may find the person by are the person's own
  const person = useQuery(query.identity.getUser.queryOptions({ params: { userId } }))
  const entrances = found.data?.entrances ?? []
  const manageable = found.data?.manageable ?? false
  const record = person.data?.user
  const when = (iso: string) => instantWords(locale, iso)
  // the system account's fields are provisioned, and never missing
  const system = person.data?.placement.mode === 'tenant-root'

  const revoke = useApiMutation({
    mutationFn: (entrance: Entrance) =>
      api.identity.deleteUserAuthBinding({ params: { userId, providerId: entrance.providerId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
    },
    onError: (error) => {
      switch (error._tag) {
        case 'AUTH_BINDING_NOT_FOUND':
          toast.error(m.error_bindingNotFound())
          return
        case 'AUTH_DEMO_ACCOUNT_LOCKED':
          toast.error(m.error_demoAccountLocked())
          return
        case 'SYSTEM_ACCOUNT_PROTECTED':
          toast.error(m.error_systemAccountProtected())
          return
        default:
          assertNever(error)
      }
    },
  })

  /** the value of the person's own field a door finds them by, if they have it */
  const fieldValue = (field: 'email' | 'businessNo') =>
    field === 'email' ? (record?.email ?? null) : (record?.businessNo ?? null)

  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead
        title={m.person_identitiesSection()}
        actions={
          entrancesHref !== undefined && (
            <PageLink
              page="auth/login-methods"
              className={stylex.props(styles.manageLink).className}
            >
              {m.person_manageWaysIn()}
            </PageLink>
          )
        }
      />
      <AsyncSection
        pending={found.isPending || person.isPending}
        error={
          found.isError
            ? describe.of(found.error)
            : person.isError
              ? describe.of(person.error)
              : null
        }
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => {
          void found.refetch()
          void person.refetch()
        }}
        skeleton={<EditorSkeleton />}
      >
        <Card data-testid="entrances">
          {entrances.length === 0 ? (
            <CardEmpty>{m.loginMethods_empty()}</CardEmpty>
          ) : (
            <Table columns="minmax(0, 1fr) minmax(0, 1.4fr) 9.5rem 9rem">
              <TableHead>
                <span>{m.loginMethods_title()}</span>
                <span>{m.person_columnAccount()}</span>
                <span>{m.person_columnLastUsed()}</span>
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
                // the field it finds them by is not there yet: the way on is
                // to fill it in, here, rather than on another page
                const missing =
                  manageable &&
                  !system &&
                  entrance.admits &&
                  resolution?.mode === 'user-field' &&
                  fieldValue(resolution.field) === null
                    ? resolution.field
                    : null
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
                        <Status tone="bad">{m.person_entranceDisabled()}</Status>
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
                      <Cell tone="quiet">{m.person_neverUsed()}</Cell>
                    ) : (
                      <Cell />
                    )}
                    {/* the way to act on it: at the end of the row, and on a phone
                        opposite the name rather than among the facts */}
                    <Cell narrow="end">
                      <span {...stylex.props(styles.end)}>
                        {missing !== null && (
                          <Button size="xs" variant="ghost" onClick={() => setFilling(missing)}>
                            {missing === 'email'
                              ? m.account_emailSetTitle()
                              : m.person_businessNoSetTitle({ businessNo: businessNoWord })}
                          </Button>
                        )}
                        {settable && (
                          <Button size="xs" variant="ghost" onClick={() => setEditing(entrance)}>
                            {(bound?.hasCredential === true
                              ? m.person_passwordReset
                              : m.person_passwordSet)()}
                          </Button>
                        )}
                        {manageable && bound !== null && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={revoke.isPending && revoke.variables === entrance}
                            onClick={() => setRevoking(entrance)}
                          >
                            {m.person_identityRevoke()}
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
          person={{
            name: record?.displayName ?? '',
            account:
              editing.resolution?.mode === 'user-field'
                ? (fieldValue(editing.resolution.field) ?? '')
                : '',
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {filling !== null && record && (
        <AccountFieldDialog
          userId={userId}
          field={filling}
          current={null}
          version={record.version}
          onClose={() => setFilling(null)}
        />
      )}

      <ConfirmDialog
        open={revoking !== null}
        tone="destructive"
        title={m.person_identityRevokeTitle()}
        description={m.person_identityRevokeBody()}
        confirmLabel={m.person_identityRevoke()}
        cancelLabel={m.action_cancel()}
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
  person,
  onClose,
}: {
  userId: string
  entrance: Entrance
  /** who the password is for, and the account they sign in by: said under the title */
  person: { name: string; account: string }
  onClose: () => void
}) {
  const api = useApi(authApi)
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()

  const binding = entrance.binding?.mode === 'managed' ? entrance.binding : null
  const [secret, setSecret] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  // said in red once a press found something wrong, for as long as it is
  const [refused, setRefused] = useState(false)
  const run = useRunApi()
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

  const reauthentication = useReauthentication(undefined)
  const save = useApiMutation({
    mutationFn: () =>
      api.identity.putUserAuthBinding({
        params: { userId, providerId: entrance.providerId },
        payload: { secret },
      }),
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
      toast.success(m.feedback_saved())
      onClose()
    },
    onError: (error) => {
      let failure: string
      switch (error._tag) {
        case 'AUTH_BINDING_AUDIENCE_EXCLUDED':
          failure = m.error_bindingAudienceExcluded()
          break
        case 'AUTH_BINDING_CREDENTIAL_INVALID':
          failure = m.error_bindingCredentialInvalid()
          break
        case 'AUTH_BINDING_UNSUPPORTED':
          failure = m.error_bindingUnsupported()
          break
        case 'AUTH_BINDING_USER_FIELD_MISSING':
          failure = m.error_bindingUserFieldMissing({ field: error.field })
          break
        case 'AUTH_DEMO_ACCOUNT_LOCKED':
          failure = m.error_demoAccountLocked()
          break
        case 'AUTH_PROVIDER_NOT_FOUND':
          failure = m.error_providerNotFound()
          break
        case 'AUTH_REAUTHENTICATION_REQUIRED':
          failure = m.error_reauthenticationRequired()
          break
        case 'SYSTEM_ACCOUNT_PROTECTED':
          failure = m.error_systemAccountProtected()
          break
        default:
          assertNever(error)
      }
      // a refused secret is said by the list under it
      if ((error as { _tag?: unknown })._tag === 'AUTH_BINDING_CREDENTIAL_INVALID') setRefused(true)
      // a way into one's own account is set once the session shows it is its owner's
      else if (needsReauthentication(error)) reauthentication.ask(() => save.mutate())
      else setFeedback(failure)
    },
  })

  if (binding === null) return null
  const replacing = entrance.bound?.hasCredential === true

  return (
    <>
      <FormDialog
        open
        // what the dialog does, never the door's own name: a door called
        // "email and password" made "set the email and password password"
        title={(replacing ? m.person_passwordResetTitle : m.person_passwordSetTitle)()}
        description={(replacing ? m.person_passwordResetFor : m.person_passwordFor)(person)}
        onClose={onClose}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {m.action_cancel()}
            </Button>
            <Button
              type="submit"
              form="user-auth-binding"
              disabled={secret === '' || save.isPending}
            >
              {m.action_save()}
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
            label={binding.secret.label}
            {...(binding.secret.hint === null ? {} : { hint: binding.secret.hint })}
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
      {reauthentication.dialog}
    </>
  )
}
