import { useQuery } from '@tanstack/react-query'
import { Suspense, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useApiQuery, useComponent } from '@qualy/web-runtime'
import { Alert, AlertDescription, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@qualy/ui/card'
import type { LoginMethod } from '@qualy/plugin-auth/contract'

// single login page: the method list and the selected driver renderer are
// both states of /login (?method=<code>), never separate pages. Drivers own
// their presentation; this shell never guesses driver routes.
export default function LoginPage() {
  const orpc = useApiQuery()
  const [searchParams, setSearchParams] = useSearchParams()
  const methodsQuery = useQuery(orpc.auth.methods.queryOptions())

  const body = () => {
    if (methodsQuery.isPending) {
      return <p className="text-sm text-muted-foreground">加载登录方式…</p>
    }
    if (methodsQuery.isError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>登录方式加载失败</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p>请检查网络后重试。</p>
            <Button variant="outline" size="sm" onClick={() => void methodsQuery.refetch()}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )
    }
    const methods = methodsQuery.data.methods
    if (methods.length === 0) {
      return <p className="text-sm text-muted-foreground">当前没有可用的登录方式，请联系管理员。</p>
    }
    const selected = methods.find(
      (method) => method.mode === 'component' && method.code === searchParams.get('method'),
    )
    if (selected && selected.mode === 'component') {
      return (
        <MethodRenderer method={selected} onBack={() => setSearchParams({})}>
          <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
            ← 其他登录方式
          </Button>
        </MethodRenderer>
      )
    }
    return (
      <div className="space-y-2">
        {methods.map((method) => (
          <Button
            key={method.code}
            variant="outline"
            className="w-full"
            onClick={() => {
              if (method.mode === 'redirect') window.location.assign(method.href)
              else setSearchParams({ method: method.code })
            }}
          >
            {method.name}
          </Button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center text-xl">Qualy 登录</CardTitle>
        </CardHeader>
        <CardContent>{body()}</CardContent>
      </Card>
    </div>
  )
}

function MethodRenderer({
  method,
  onBack,
  children,
}: {
  method: LoginMethod & { mode: 'component' }
  onBack: () => void
  children: ReactNode
}) {
  const Renderer = useComponent(method.component)
  if (!Renderer) {
    // fail closed: the driver's client is not part of this build
    return (
      <Alert variant="destructive">
        <AlertTitle>该登录方式暂不可用</AlertTitle>
        <AlertDescription className="mt-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            返回
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <div className="space-y-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">加载中…</p>}>
        <Renderer method={method} onAuthenticated={() => window.location.assign('/')} />
      </Suspense>
      {children}
    </div>
  )
}
