import { assertNever, getApiErrorCode } from '@qualy/web-i18n'

import {
  useRunApi,
  useApiMutation,
  useApi,
  useApiQuery,
  useLoadFailure,
  usePageHref,
} from '@qualy/web-runtime'

import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'

import { AsyncSection, Field, FormDialog, useSettledCheck } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Card, DefListSkeleton, SectionHead } from '@qualy/ui/screen'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

import { authApi } from '../api.ts'
import { EmailWithStanding } from '../iam/person-facts.tsx'
import { emailShaped } from '../iam/users/field-refusals.ts'
import { SessionsCard } from './security-records.tsx'
import { PasswordChecklist } from '../password/PasswordChecklist.tsx'
import { usePasswordChecks } from '../password/checks.ts'
import { needsReauthentication, useReauthentication } from './Reauthentication.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// The reader's own password and address, as two lines of one card: what
// stands now, and the one thing that can be done about it. Doing it is a
// dialog - a sheet from the foot on a phone - so the page stays the list of
// what stands. Under them what is signed in as the reader now; the history
// is elsewhere.
//
// A password is changed with the current one; somebody who has none sets one
// only once their address is proven, because the address is what a forgotten
// password comes back through. A new address takes effect when the link sent
// to it is followed, not before. Setting a first password and moving the
// address both ask the reader to show it is them first.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
  setting: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 14,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  // the name, what stands, and the action - one line wherever there is room
  line: {
    display: 'grid',
    gridTemplateColumns: {
      default: '6rem minmax(0, 1fr) auto',
      [breakpoints.phone]: 'minmax(0, 1fr) auto',
    },
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
    minHeight: 32,
  },
  name: {
    fontSize: 13,
    fontWeight: 500,
    gridColumn: { default: null, [breakpoints.phone]: '1 / -1' },
  },
  standing: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    fontSize: 13.5,
  },
  quiet: { fontSize: 13, color: tokens.mutedForeground },
  actions: { display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'end' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  refusal: { margin: 0, fontSize: 13, color: tokens.danger },
})

export default function AccountSecurityPage() {
  const query = useApiQuery(authApi)

  const describe = useLoadFailure()
  const self = useQuery(query.self.getSelf.queryOptions())
  const me = self.data
  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead title={m.account_security()} />
      <AsyncSection
        pending={self.isPending}
        error={self.isError ? describe.of(self.error) : null}
        loadingLabel={commonMessages.state_loading()}
        retryLabel={commonMessages.action_retry()}
        onRetry={() => void self.refetch()}
        skeleton={
          <Card>
            <DefListSkeleton rows={2} />
          </Card>
        }
      >
        {me && (
          <>
            <Card data-testid="security-settings">
              <PasswordSetting standing={me.passwordStatus} emailVerified={me.emailVerified} />
              <EmailSetting email={me.email} verified={me.emailVerified} />
            </Card>
            <SessionsCard />
          </>
        )}
      </AsyncSection>
    </div>
  )
}

/** one setting: its name, what stands, its action, and the form it opens */
function Setting({
  testId,
  name,
  standing,
  actions,
  children,
  ...data
}: {
  testId: string
  name: string
  standing: ReactNode
  actions?: ReactNode
  children?: ReactNode
} & Record<`data-${string}`, string>) {
  return (
    <div data-testid={testId} {...data} {...stylex.props(styles.setting)}>
      <div {...stylex.props(styles.line)}>
        <span {...stylex.props(styles.name)}>{name}</span>
        <span {...stylex.props(styles.standing)}>{standing}</span>
        {actions !== undefined && <span {...stylex.props(styles.actions)}>{actions}</span>}
      </div>
      {children}
    </div>
  )
}

function PasswordSetting({
  standing,
  emailVerified,
}: {
  standing: 'set' | 'unset' | 'unavailable'
  emailVerified: boolean
}) {
  const api = useApi(authApi)
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()

  const formId = useId()
  const reauthentication = useReauthentication(usePageHref('auth/account-security'))
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [fresh, setFresh] = useState('')
  const [again, setAgain] = useState('')
  const [mismatch, setMismatch] = useState(false)
  // said in red once a press found something wrong, for as long as it is
  const [refused, setRefused] = useState(false)
  const rule = useQuery(query.auth.listLoginMethods.queryOptions()).data?.passwordRule ?? null
  const run = useRunApi()
  const checks = usePasswordChecks({
    password: fresh,
    min: rule?.minLength ?? 0,
    max: rule?.maxLength ?? Number.POSITIVE_INFINITY,
    scope: ['self'],
    assess: (typed) =>
      run(api.self.createSelfPasswordAssessment({ payload: { password: typed } })).then(
        (answer) => answer.checks,
      ),
  })
  const close = () => {
    setOpen(false)
    setCurrent('')
    setFresh('')
    setAgain('')
    setMismatch(false)
    setRefused(false)
  }
  const [failure, setFailure] = useState<string | null>(null)
  const save = useApiMutation({
    mutationFn: () =>
      api.self.putSelfPassword({
        payload: {
          newPassword: fresh,
          ...(standing === 'set' ? { currentPassword: current } : {}),
        },
      }),
    onSuccess: async () => {
      close()
      toast.success(m.account_passwordChanged())
      await queryClient.invalidateQueries({ queryKey: query.self.key() })
    },
    onMutate: () => setFailure(null),
    onError: (error) => {
      switch (error._tag) {
        case 'AUTH_BINDING_CREDENTIAL_INVALID':
          setRefused(true)
          return
        case 'AUTH_REAUTHENTICATION_REQUIRED':
          reauthentication.ask(() => save.mutate())
          return
        case 'AUTH_PASSWORD_INCORRECT':
          setFailure(m.error_passwordIncorrect())
          return
        case 'AUTH_EMAIL_UNVERIFIED':
          setFailure(m.error_emailUnverified())
          return
        case 'AUTH_PASSWORD_UNAVAILABLE':
          setFailure(m.error_passwordUnavailable())
          return
        case 'AUTH_DEMO_ACCOUNT_LOCKED':
          setFailure(m.error_demoAccountLocked())
          return
        case 'USER_NOT_FOUND':
          setFailure(m.error_userNotFound())
          return
        default:
          assertNever(error)
      }
    },
  })
  const refusedByList = save.isError && save.error._tag === 'AUTH_BINDING_CREDENTIAL_INVALID'
  const settable = standing === 'set' || (standing === 'unset' && emailVerified)
  const said =
    standing === 'unavailable'
      ? m.account_passwordNotOpen()
      : standing === 'set'
        ? m.account_passwordIsSet()
        : settable
          ? m.account_passwordIsUnset()
          : m.account_passwordNeedsEmail()
  return (
    <Setting
      testId="password-card"
      data-standing={standing}
      name={m.account_password()}
      standing={<span {...stylex.props(standing !== 'set' && styles.quiet)}>{said}</span>}
      {...(settable
        ? {
            actions: (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  // a password they hold is asked for in the form itself
                  standing === 'set' ? setOpen(true) : reauthentication.ensure(() => setOpen(true))
                }
              >
                {(standing === 'set' ? m.account_passwordChange : m.account_passwordSet)()}
              </Button>
            ),
          }
        : {})}
    >
      {reauthentication.dialog}
      <FormDialog
        open={settable && open}
        title={(standing === 'set' ? m.account_passwordChange : m.account_passwordSet)()}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={close}>
              {m.action_cancel()}
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={save.isPending || !fresh || !again || (standing === 'set' && !current)}
            >
              {m.account_passwordSave()}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          {...stylex.props(styles.form)}
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (!checks.passable) {
              setRefused(true)
              return
            }
            if (fresh !== again) {
              setMismatch(true)
              return
            }
            setMismatch(false)
            if (!save.isPending) save.mutate()
          }}
        >
          {standing === 'set' && (
            <Field label={m.account_currentPassword()} required>
              {(id, control) => (
                <Input
                  id={id}
                  {...control}
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                />
              )}
            </Field>
          )}
          <Field label={m.reset_newPassword()} required>
            {(id, control) => (
              <Input
                id={id}
                {...control}
                type="password"
                autoComplete="new-password"
                autoFocus={standing !== 'set'}
                value={fresh}
                onChange={(event) => setFresh(event.target.value)}
              />
            )}
          </Field>
          {rule !== null && (
            <PasswordChecklist
              checks={checks}
              password={fresh}
              min={rule.minLength}
              refused={refused}
            />
          )}
          <Field label={m.reset_confirmPassword()} required>
            {(id, control) => (
              <Input
                id={id}
                {...control}
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(event) => setAgain(event.target.value)}
              />
            )}
          </Field>
          {mismatch && (
            <p data-testid="password-mismatch" {...stylex.props(styles.refusal)}>
              {m.reset_mismatch()}
            </p>
          )}
          {save.isError &&
            failure !== null &&
            !refusedByList &&
            !needsReauthentication(save.error) && (
              <p {...stylex.props(styles.refusal)}>{failure}</p>
            )}
        </form>
      </FormDialog>
    </Setting>
  )
}

function EmailSetting({ email, verified }: { email: string | null; verified: boolean }) {
  const api = useApi(authApi)

  const formId = useId()
  const reauthentication = useReauthentication(usePageHref('auth/account-security'))
  const [open, setOpen] = useState(false)
  const [next, setNext] = useState('')
  const shape = useSettledCheck(next, (typed) =>
    emailShaped(typed) ? null : m.person_emailInvalid(),
  )
  const close = () => {
    setOpen(false)
    setNext('')
    change.reset()
  }
  const verify = useApiMutation({
    mutationFn: () => api.self.createSelfEmailVerification({}),
    onSuccess: () => toast.success(m.account_verificationSent()),
    onError: (error) => {
      switch (error._tag) {
        case 'AUTH_EMAIL_MISSING':
          toast.error(m.error_emailMissing())
          return
        case 'AUTH_MAIL_NOT_SENT':
          toast.error(m.error_mailNotSent())
          return
        case 'USER_NOT_FOUND':
          toast.error(m.error_userNotFound())
          return
        default:
          assertNever(error)
      }
    },
  })
  const [failure, setFailure] = useState<string | null>(null)
  const change = useApiMutation({
    mutationFn: () => api.self.createSelfEmailChange({ payload: { newEmail: next } }),
    onSuccess: () => {
      close()
      toast.success(m.account_changeSent())
    },
    onMutate: () => setFailure(null),
    onError: (error) => {
      switch (error._tag) {
        case 'AUTH_REAUTHENTICATION_REQUIRED':
          reauthentication.ask(() => change.mutate())
          return
        case 'USER_EMAIL_CONFLICT':
          setFailure(m.error_userEmailConflict())
          return
        case 'SYSTEM_ACCOUNT_PROTECTED':
          setFailure(m.error_systemAccountProtected())
          return
        case 'AUTH_MAIL_NOT_SENT':
          setFailure(m.error_mailNotSent())
          return
        case 'AUTH_DEMO_ACCOUNT_LOCKED':
          setFailure(m.error_demoAccountLocked())
          return
        case 'USER_NOT_FOUND':
          setFailure(m.error_userNotFound())
          return
        default:
          assertNever(error)
      }
    },
  })
  // an address somebody else holds is the field's to say; the rest the form's
  const taken = change.isError && getApiErrorCode(change.error) === 'USER_EMAIL_CONFLICT'
  return (
    <Setting
      testId="email-card"
      name={m.users_email()}
      standing={<EmailWithStanding email={email} verified={verified} />}
      actions={
        <>
          {email !== null && !verified && (
            <Button
              size="xs"
              variant="ghost"
              disabled={verify.isPending}
              onClick={() => verify.mutate()}
            >
              {m.account_sendVerification()}
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            onClick={() => reauthentication.ensure(() => setOpen(true))}
          >
            {(email === null ? m.account_emailSet : m.account_emailChange)()}
          </Button>
        </>
      }
    >
      {reauthentication.dialog}
      <FormDialog
        open={open}
        title={(email === null ? m.account_emailSetTitle : m.account_emailChangeTitle)()}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={close}>
              {m.action_cancel()}
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={change.isPending || next.trim() === '' || !emailShaped(next)}
            >
              {m.account_sendChange()}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          {...stylex.props(styles.form)}
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (!change.isPending && emailShaped(next)) change.mutate()
          }}
        >
          <Field
            label={m.account_newEmail()}
            required
            hint={(email === null ? m.account_changeHint : m.account_changeConsequence)()}
            error={taken ? m.error_userEmailConflict() : shape.error}
          >
            {(id, control) => (
              <Input
                id={id}
                {...control}
                type="email"
                autoComplete="email"
                autoFocus
                value={next}
                onBlur={shape.onBlur}
                onChange={(event) => {
                  setNext(event.target.value)
                  if (taken) change.reset()
                }}
              />
            )}
          </Field>
          {change.isError && failure !== null && !taken && !needsReauthentication(change.error) && (
            <p {...stylex.props(styles.refusal)}>{failure}</p>
          )}
        </form>
      </FormDialog>
    </Setting>
  )
}
