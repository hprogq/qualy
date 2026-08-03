import { useQuery } from '@tanstack/react-query'
import { Suspense, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useApiQuery, useComponent, useSessionTransition } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Alert, AlertDescription, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@qualy/ui/card'
import { Spinner } from '@qualy/ui/spinner'
import type { LoginMethod } from '@qualy/plugin-auth/contract'
import { authMessages as m } from './i18n.ts'

// single login page: the method list and the selected driver renderer are
// both states of /login (?method=<code>), never separate pages. Drivers own
// their presentation; this shell never guesses driver routes.
export default function LoginPage() {
  const orpc = useApiQuery()
  const { format } = useI18n()
  const startSession = useSessionTransition()
  const [searchParams, setSearchParams] = useSearchParams()

  // a new identity must not inherit the previous one's cache; the runtime
  // drops it and refetches the manifest, which decides where home now is
  const onAuthenticated = () => {
    void startSession({ destination: { kind: 'home' } })
  }
  const methodsQuery = useQuery(orpc.auth.methods.queryOptions())

  const body = () => {
    if (methodsQuery.isPending) {
      return (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      )
    }
    if (methodsQuery.isError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>{format(m.methodsFailedTitle)}</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p>{format(m.methodsFailedHint)}</p>
            <Button variant="outline" size="sm" onClick={() => void methodsQuery.refetch()}>
              {format(commonMessages.retry)}
            </Button>
          </AlertDescription>
        </Alert>
      )
    }
    const methods = methodsQuery.data.methods
    if (methods.length === 0) {
      return <p className="text-sm text-muted-foreground">{format(m.noMethods)}</p>
    }
    const selected = methods.find(
      (method) => method.mode === 'component' && method.code === searchParams.get('method'),
    )
    if (selected && selected.mode === 'component') {
      return (
        <MethodRenderer
          method={selected}
          onBack={() => setSearchParams({})}
          onAuthenticated={onAuthenticated}
        >
          <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
            {format(m.otherMethods)}
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
              // redirect drivers are document navigations by design: the api
              // endpoint answers 302 towards the external identity provider
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
          <CardTitle className="text-center text-xl">{format(m.title)}</CardTitle>
        </CardHeader>
        <CardContent>{body()}</CardContent>
      </Card>
    </div>
  )
}

function MethodRenderer({
  method,
  onBack,
  onAuthenticated,
  children,
}: {
  method: LoginMethod & { mode: 'component' }
  onBack: () => void
  onAuthenticated: () => void
  children: ReactNode
}) {
  const { format } = useI18n()
  const Renderer = useComponent(method.component)
  if (!Renderer) {
    // fail closed: the driver's client is not part of this build
    return (
      <Alert variant="destructive">
        <AlertTitle>{format(m.rendererMissing)}</AlertTitle>
        <AlertDescription className="mt-2">
          <Button variant="outline" size="sm" onClick={onBack}>
            {format(commonMessages.back)}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <div className="space-y-4">
      <Suspense
        fallback={
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        }
      >
        <Renderer method={method} onAuthenticated={onAuthenticated} />
      </Suspense>
      {children}
    </div>
  )
}
