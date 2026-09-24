import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Card, DefListSkeleton, SectionHead } from '@qualy/ui/screen'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { EmailWithStanding } from '../iam/person-facts.tsx'
import { SessionsCard } from './security-records.tsx'
import { PasswordChecklist } from '../password/PasswordChecklist.tsx'
import { usePasswordChecks } from '../password/checks.ts'

// The reader's own password and address, as two lines of one card: what
// stands now, and the one thing that can be done about it. Doing it is a
// dialog - a sheet from the foot on a phone - so the page stays the list of
// what stands. Under them what is signed in as the reader now; the history
// is elsewhere.
//
// A password is changed with the current one; somebody who has none sets one
// only once their address is proven, because the address is what a forgotten
// password comes back through. A new address takes effect when the link sent
// to it is followed, not before.

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
  const { format, formatError } = useI18n()
  const self = useQuery(query.self.getSelf.queryOptions())
  const me = self.data
  return (
    <div {...stylex.props(styles.page)}>
      <SectionHead title={format(m.accountSecurity)} />
      <AsyncSection
        pending={self.isPending}
        error={self.isError ? formatError(self.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
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
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [fresh, setFresh] = useState('')
  const [again, setAgain] = useState('')
  const [mismatch, setMismatch] = useState(false)
  // said in red once a press found something wrong, for as long as it is
  const [refused, setRefused] = useState(false)
  const rule = useQuery(query.auth.listLoginMethods.queryOptions()).data?.passwordRule ?? null
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
  const save = useMutation({
    mutationFn: () =>
      run(
        api.self.putSelfPassword({
          payload: {
            newPassword: fresh,
            ...(standing === 'set' ? { currentPassword: current } : {}),
          },
        }),
      ),
    onSuccess: async () => {
      close()
      toast.success(format(m.passwordChanged))
      await queryClient.invalidateQueries({ queryKey: query.self.key() })
    },
    onError: (error: unknown) => {
      if ((error as { _tag?: unknown })._tag === 'AUTH_BINDING_CREDENTIAL_INVALID') setRefused(true)
    },
  })
  const refusedByList =
    save.isError && (save.error as { _tag?: unknown })._tag === 'AUTH_BINDING_CREDENTIAL_INVALID'
  const settable = standing === 'set' || (standing === 'unset' && emailVerified)
  const said =
    standing === 'unavailable'
      ? format(m.passwordNotOpen)
      : standing === 'set'
        ? format(m.passwordIsSet)
        : settable
          ? format(m.passwordIsUnset)
          : format(m.passwordNeedsEmail)
  return (
    <Setting
      testId="password-card"
      data-standing={standing}
      name={format(m.passwordSection)}
      standing={<span {...stylex.props(standing !== 'set' && styles.quiet)}>{said}</span>}
      {...(settable
        ? {
            actions: (
              <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
                {format(standing === 'set' ? m.passwordChange : m.passwordSetFirst)}
              </Button>
            ),
          }
        : {})}
    >
      <FormDialog
        open={settable && open}
        title={format(standing === 'set' ? m.passwordChange : m.passwordSetFirst)}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={close}>
              {format(m.cancel)}
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={save.isPending || !fresh || !again || (standing === 'set' && !current)}
            >
              {format(m.passwordSave)}
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
            <Field label={format(m.currentPassword)}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                />
              )}
            </Field>
          )}
          <Field label={format(m.resetNewPassword)}>
            {(id) => (
              <Input
                id={id}
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
          <Field label={format(m.resetConfirmPassword)}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(event) => setAgain(event.target.value)}
              />
            )}
          </Field>
          {mismatch && (
            <p data-testid="password-mismatch" {...stylex.props(styles.refusal)}>
              {format(m.passwordMismatch)}
            </p>
          )}
          {save.isError && !refusedByList && (
            <p {...stylex.props(styles.refusal)}>{formatError(save.error)}</p>
          )}
        </form>
      </FormDialog>
    </Setting>
  )
}

function EmailSetting({ email, verified }: { email: string | null; verified: boolean }) {
  const api = useApi(authApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [next, setNext] = useState('')
  const close = () => {
    setOpen(false)
    setNext('')
  }
  const verify = useMutation({
    mutationFn: () => run(api.self.createSelfEmailVerification({})),
    onSuccess: () => toast.success(format(m.verificationSent)),
    onError: (error: unknown) => toast.error(formatError(error)),
  })
  const change = useMutation({
    mutationFn: () => run(api.self.createSelfEmailChange({ payload: { newEmail: next } })),
    onSuccess: () => {
      close()
      toast.success(format(m.changeSent))
    },
  })
  return (
    <Setting
      testId="email-card"
      name={format(m.emailLabel)}
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
              {format(m.sendVerification)}
            </Button>
          )}
          <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
            {format(email === null ? m.emailSetAction : m.emailChangeAction)}
          </Button>
        </>
      }
    >
      <FormDialog
        open={open}
        title={format(email === null ? m.emailSetTitle : m.emailChangeTitle)}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={close}>
              {format(m.cancel)}
            </Button>
            <Button type="submit" form={formId} disabled={change.isPending || !next}>
              {format(m.sendChange)}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          {...stylex.props(styles.form)}
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (!change.isPending) change.mutate()
          }}
        >
          <Field label={format(m.newEmail)} hint={format(m.changeHint)}>
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                autoFocus
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            )}
          </Field>
          {change.isError && <p {...stylex.props(styles.refusal)}>{formatError(change.error)}</p>}
        </form>
      </FormDialog>
    </Setting>
  )
}
