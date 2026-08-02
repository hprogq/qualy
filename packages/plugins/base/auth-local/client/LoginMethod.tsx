import { useState, type FormEvent } from 'react'
import { useApi } from '@qualy/web-runtime'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import type { LoginMethod } from '@qualy/plugin-auth/contract'

interface Props {
  method: LoginMethod
  onAuthenticated: () => void
}

// embedded credential renderer: the auth core's login shell owns the page,
// this form only proves the user against one local provider instance
export default function LocalLoginMethod({ method, onAuthenticated }: Props) {
  const api = useApi()
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
      await api.authLocal.login({ providerCode: method.code, identifier, password })
      onAuthenticated()
    } catch {
      setError('用户名或密码错误')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="identifier">用户名</Label>
        <Input
          id="identifier"
          autoComplete="username"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">密码</Label>
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
        {busy ? '登录中…' : '登录'}
      </Button>
    </form>
  )
}
