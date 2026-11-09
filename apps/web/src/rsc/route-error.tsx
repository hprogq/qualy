'use client'
import { useEffect, useRef } from 'react'
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
import { RotateCwIcon, TriangleAlertIcon, WifiOffIcon } from 'lucide-react'
import * as messages from '@qualy/web-i18n/messages'
import { emergencyCss } from './emergency-document.ts'

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
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (shown.kind === 'failed') captureException(error)
  }, [error, shown.kind])
  useEffect(() => {
    if (fullscreen) heading.current?.focus({ preventScroll: true })
  }, [fullscreen])
  const retrying = navigation.state !== 'idle'
  const retry = () => {
    if (!retrying)
      void navigate(location, { replace: true, state: location.state, preventScrollReset: true })
  }
  if (fullscreen) {
    const Mark = shown.kind === 'offline' ? WifiOffIcon : TriangleAlertIcon
    return (
      <main data-testid="route-error" data-qualy-emergency="">
        <title>{shown.title} - Qualy</title>
        <style>{emergencyCss}</style>
        <div data-slot="resource-state" data-state={shown.kind}>
          <Mark aria-hidden data-emergency-mark="" width={36} height={36} strokeWidth={1.5} />
          <h1 ref={heading} tabIndex={-1}>
            {shown.title}
          </h1>
          <p>{shown.description}</p>
          <div data-emergency-actions="">
            {shown.retryable && (
              <button
                type="button"
                aria-busy={retrying || undefined}
                aria-disabled={retrying || undefined}
                data-emergency-primary=""
                onClick={retry}
              >
                <RotateCwIcon aria-hidden width={16} height={16} />
                {messages.action_retry()}
              </button>
            )}
            <Link to="/" data-emergency-primary={shown.retryable ? undefined : ''}>
              {messages.action_goHome()}
            </Link>
          </div>
        </div>
      </main>
    )
  }
  return (
    <div data-testid="route-error" {...stylex.props(styles.container)}>
      <title>{shown.title} - Qualy</title>
      <Failure
        {...shown}
        retrying={retrying}
        {...(shown.retryable ? { onRetry: retry } : {})}
        actions={[
          <Button key="home" asChild variant={shown.retryable ? 'outline' : 'default'}>
            <Link to="/">{messages.action_goHome()}</Link>
          </Button>,
        ]}
      />
    </div>
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
