import { useState, type FormEvent } from 'react'
import { useApi } from '@qualy/web-runtime'

export default function LoginPage() {
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
      await api.auth.loginLocal({ identifier, password })
      // full reload refetches /auth/me and the manifest with the new session
      window.location.assign('/')
    } catch {
      setError('用户名或密码错误')
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 320, margin: '15vh auto', fontFamily: 'sans-serif' }}>
      <h1>Qualy 登录</h1>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <input
            style={{ width: '100%', padding: 8 }}
            placeholder="用户名"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <input
            style={{ width: '100%', padding: 8 }}
            type="password"
            placeholder="密码"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button type="submit" disabled={busy || !identifier || !password} style={{ padding: 8 }}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
