import { useQuery } from '@tanstack/react-query'
import { Suspense, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery, useComponent, useSessionTransition } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Alert, AlertDescription, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { Card } from '@qualy/ui/card'
import { Spinner } from '@qualy/ui/spinner'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import type { LoginMethod } from '@qualy/auth-contract/login'
import { authMessages as m } from './i18n.ts'
import { authApi } from './api.ts'

// single login page: the method list and the selected driver renderer are
// both states of /login (?method=<code>), never separate pages. Drivers own
// their presentation; this shell never guesses driver routes.

const styles = stylex.create({
  ground: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    padding: 16,
  },
  door: {
    width: '100%',
    maxWidth: 384,
  },
  title: {
    marginBottom: 24,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 500,
  },
  waiting: {
    display: 'flex',
    justifyContent: 'center',
    paddingBlock: 24,
  },
  failBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginTop: 8,
  },
  quiet: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  methods: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  fullKey: {
    width: '100%',
  },
  renderer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
})

export default function LoginPage() {
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  const startSession = useSessionTransition()
  const [searchParams, setSearchParams] = useSearchParams()

  // a new identity must not inherit the previous one's cache; the runtime
  // drops it and refetches the manifest, which decides where home now is
  const onAuthenticated = () => {
    void startSession({ destination: { kind: 'home' } })
  }
  const methodsQuery = useQuery(query.auth.listLoginMethods.queryOptions())

  const body = () => {
    if (methodsQuery.isPending) {
      return (
        <div {...stylex.props(styles.waiting)}>
          <Spinner />
        </div>
      )
    }
    if (methodsQuery.isError) {
      return (
        <Alert variant="destructive">
          <AlertTitle>{format(m.methodsFailedTitle)}</AlertTitle>
          <AlertDescription>
            <div {...stylex.props(styles.failBody)}>
              <p>{format(m.methodsFailedHint)}</p>
              <Button variant="outline" size="sm" onClick={() => void methodsQuery.refetch()}>
                {format(commonMessages.retry)}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )
    }
    const methods = methodsQuery.data.methods
    if (methods.length === 0) {
      return <p {...stylex.props(styles.quiet)}>{format(m.noMethods)}</p>
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
      <div {...stylex.props(styles.methods)}>
        {methods.map((method) => (
          <Button
            key={method.code}
            variant="outline"
            className={stylex.props(styles.fullKey).className}
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
    <div {...stylex.props(styles.ground)}>
      <Card xstyle={styles.door}>
        <h1 {...stylex.props(styles.title)}>{format(m.title)}</h1>
        {body()}
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
        <AlertDescription>
          <div {...stylex.props(styles.failBody)}>
            <Button variant="outline" size="sm" onClick={onBack}>
              {format(commonMessages.back)}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <div {...stylex.props(styles.renderer)}>
      <Suspense
        fallback={
          <div {...stylex.props(styles.waiting)}>
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
