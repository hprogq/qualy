import { useState, type FormEvent } from 'react'
import { useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import type { LoginMethodRendererProps } from '@qualy/auth-contract/login'
import { localMessages as m } from './i18n.ts'

// embedded credential renderer: the auth core's login shell owns the page,
// this form only proves the user against one local provider instance
export default function LocalLoginMethod({ method, onAuthenticated }: LoginMethodRendererProps) {
  const api = useApi()
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await run(
        api.authLocal.login({
          params: { providerCode: method.code },
          payload: { identifier, password },
        }),
      )
      onAuthenticated()
    } catch (failure: unknown) {
      setError(formatError(failure))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="identifier">{format(m.identifier)}</Label>
        <Input
          id="identifier"
          autoComplete="username"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{format(m.password)}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || !identifier || !password}>
        {busy ? format(m.submitting) : format(m.submit)}
      </Button>
    </form>
  )
}
