import { useEffect, useState } from 'react'
import { useApi } from '@qualy/web-runtime'

interface Method {
  code: string
  type: string
  name: string
  interaction: 'credentials' | 'redirect'
}

// login entry: lists the tenant's enabled login methods; credential methods
// open their driver page, redirect methods jump straight to the api start url
export default function LoginPage() {
  const api = useApi()
  const [methods, setMethods] = useState<Method[] | null>(null)

  useEffect(() => {
    api.auth
      .methods()
      .then((result) => setMethods(result.methods))
      .catch(() => setMethods([]))
  }, [api])

  return (
    <div style={{ maxWidth: 320, margin: '15vh auto', fontFamily: 'sans-serif' }}>
      <h1>Qualy 登录</h1>
      {methods === null && <p>加载中…</p>}
      {methods?.length === 0 && <p>当前没有可用的登录方式，请联系管理员。</p>}
      {methods?.map((method) => (
        <p key={method.code}>
          <a
            style={{
              display: 'block',
              padding: 10,
              textAlign: 'center',
              border: '1px solid #ccc',
              borderRadius: 6,
              textDecoration: 'none',
            }}
            href={
              method.interaction === 'credentials'
                ? `/login/${method.type}?provider=${encodeURIComponent(method.code)}`
                : `/api/auth/${method.type}/${encodeURIComponent(method.code)}/start`
            }
          >
            {method.name}
          </a>
        </p>
      ))}
    </div>
  )
}
