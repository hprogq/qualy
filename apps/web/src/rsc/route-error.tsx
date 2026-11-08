'use client'
import { useEffect } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  isRouteErrorResponse,
  Link,
  useLocation,
  useNavigate,
  useNavigation,
  useRouteError,
} from 'react-router'
import { captureException } from '@qualy/browser-observability'
import { Failure, useLoadFailure } from '@qualy/web-runtime'
import { Button } from '@qualy/ui/button'
import * as messages from '@qualy/web-i18n/messages'

const styles = stylex.create({
  container: { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, width: '100%' },
})

/** Router failures include loader, transport and server-render errors. */
function RouteError({ fullscreen = false }: { fullscreen?: boolean }) {
  const error = useRouteError()
  const describe = useLoadFailure()
  const location = useLocation()
  const navigate = useNavigate()
  const navigation = useNavigation()
  const failure = isRouteErrorResponse(error)
    ? describe.of({
        _tag:
          error.status === 403
            ? 'ACCESS_DENIED'
            : error.status >= 500
              ? 'SERVICE_UNAVAILABLE'
              : 'ROUTE_FAILED',
      })
    : describe.of(error)
  const shown = isRouteErrorResponse(error) && error.status === 404 ? describe.missing() : failure
  useEffect(() => {
    if (shown.kind === 'failed') captureException(error)
  }, [error, shown.kind])
  const Container = fullscreen ? 'main' : 'div'
  return (
    <Container data-testid="route-error" {...stylex.props(styles.container)}>
      <title>{shown.title} - Qualy</title>
      <Failure
        {...shown}
        fullscreen={fullscreen}
        retrying={navigation.state !== 'idle'}
        {...(shown.retryable
          ? {
              onRetry: () =>
                void navigate(location, {
                  replace: true,
                  state: location.state,
                  preventScrollReset: true,
                }),
            }
          : {})}
        actions={[
          <Button key="home" asChild variant={shown.retryable ? 'outline' : 'default'}>
            <Link to="/">{messages.action_goHome()}</Link>
          </Button>,
        ]}
      />
    </Container>
  )
}

/** No runtime or plugin surface needs to have loaded for this boundary. */
export function DocumentError() {
  return <RouteError fullscreen />
}

export function PageError() {
  return <RouteError />
}

export function LayoutError() {
  return <RouteError fullscreen />
}
