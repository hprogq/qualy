import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Card, CardEmpty, CardFoot, CardHead, EditorSkeleton, SectionHead, Spacer } from '@qualy/ui/screen'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { EmailWithStanding } from '../iam/person-facts.tsx'

// The reader's own password and address: changing the one, proving and
// moving the other. A password is changed with the current one; somebody
// who has none sets one only once their address is proven, because the
// address is what a forgotten password comes back through. A new address
// takes effect when the link sent to it is followed, not before.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 12 },
  fields: { display: 'flex', flexDirection: 'column', gap: 14, paddingInline: 16, paddingBlock: 14 },
  line: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingInline: 16, paddingBlock: 14 },
  refusal: { margin: 0, fontSize: 13, color: tokens.danger },
  quiet: { fontSize: 13, color: tokens.mutedForeground },
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
        skeleton={<EditorSkeleton />}
      >
        {me && (
          <>
            <PasswordCard standing={me.passwordStatus} emailVerified={me.emailVerified} />
            <EmailCard email={me.email} verified={me.emailVerified} />
          </>
        )}
      </AsyncSection>
    </div>
  )
}

function PasswordCard({
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
  const [current, setCurrent] = useState('')
  const [fresh, setFresh] = useState('')
  const [again, setAgain] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const save = useMutation({
    mutationFn: () =>
      run(
        api.self.putSelfPassword({
          payload: { newPassword: fresh, ...(standing === 'set' ? { currentPassword: current } : {}) },
        }),
      ),
    onSuccess: async () => {
      setCurrent('')
      setFresh('')
      setAgain('')
      toast.success(format(m.passwordChanged))
      await queryClient.invalidateQueries({ queryKey: query.self.key() })
    },
  })
  const settable = standing === 'set' || (standing === 'unset' && emailVerified)
  return (
    <Card data-testid="password-card" data-standing={standing}>
      <CardHead title={format(m.passwordSection)} />
      {standing === 'unavailable' ? (
        <CardEmpty>{format(m.passwordNotOpen)}</CardEmpty>
      ) : !settable ? (
        <CardEmpty>{format(m.passwordNeedsEmail)}</CardEmpty>
      ) : (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (fresh !== again) {
              setMismatch(true)
              return
            }
            setMismatch(false)
            if (!save.isPending) save.mutate()
          }}
        >
          <div {...stylex.props(styles.fields)}>
            {standing === 'set' && (
              <Field label={format(m.currentPassword)}>
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="current-password"
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
                  value={fresh}
                  onChange={(event) => setFresh(event.target.value)}
                />
              )}
            </Field>
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
            {save.isError && <p {...stylex.props(styles.refusal)}>{formatError(save.error)}</p>}
          </div>
          <CardFoot inset>
            <Spacer />
            <Button
              size="sm"
              type="submit"
              disabled={save.isPending || !fresh || !again || (standing === 'set' && !current)}
            >
              {format(standing === 'set' ? m.passwordChange : m.passwordSetFirst)}
            </Button>
          </CardFoot>
        </form>
      )}
    </Card>
  )
}

function EmailCard({ email, verified }: { email: string | null; verified: boolean }) {
  const api = useApi(authApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [next, setNext] = useState('')
  const verify = useMutation({
    mutationFn: () => run(api.self.createSelfEmailVerification({})),
    onSuccess: () => toast.success(format(m.verificationSent)),
    onError: (error: unknown) => toast.error(formatError(error)),
  })
  const change = useMutation({
    mutationFn: () => run(api.self.createSelfEmailChange({ payload: { newEmail: next } })),
    onSuccess: () => {
      setNext('')
      toast.success(format(m.changeSent))
    },
  })
  return (
    <Card data-testid="email-card">
      <CardHead title={format(m.emailLabel)} />
      <div {...stylex.props(styles.line)}>
        <EmailWithStanding email={email} verified={verified} />
        {email !== null && !verified && (
          <Button
            size="xs"
            variant="outline"
            disabled={verify.isPending}
            onClick={() => verify.mutate()}
          >
            {format(m.sendVerification)}
          </Button>
        )}
      </div>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (!change.isPending) change.mutate()
        }}
      >
        <div {...stylex.props(styles.fields)}>
          <Field label={format(m.newEmail)}>
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            )}
          </Field>
          {change.isError && <p {...stylex.props(styles.refusal)}>{formatError(change.error)}</p>}
        </div>
        <CardFoot inset>
          <span {...stylex.props(styles.quiet)}>{format(m.changeHint)}</span>
          <Spacer />
          <Button size="sm" type="submit" disabled={change.isPending || !next}>
            {format(m.sendChange)}
          </Button>
        </CardFoot>
      </form>
    </Card>
  )
}
