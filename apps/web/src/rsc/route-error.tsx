'use client'
import { useEffect, useRef, useState } from 'react'
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
import {
  CopyIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from 'lucide-react'
import { RenderResponseError } from '@qualy/web-runtime/render-network-error'
import * as messages from '@qualy/web-i18n/messages'
import { emergencyCss } from './emergency-document.ts'

const styles = stylex.create({
  container: { display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, width: '100%' },
  reference: { fontSize: 12, overflowWrap: 'anywhere' },
})

const browserProblemId = () =>
  'W-' +
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

function ProblemReference({ id }: { id: string }) {
  const code = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState<string>()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(id)
    } catch {
      if (code.current === null) return
      const range = document.createRange()
      range.selectNodeContents(code.current)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  }
  return (
    <div data-problem-reference="" {...stylex.props(styles.reference)}>
      {messages.load_problemId()} <code ref={code}>{id}</code>
      <button type="button" aria-label={messages.load_copyProblemId()} onClick={() => void copy()}>
        <CopyIcon aria-hidden width={14} height={14} />
      </button>
      <span role="status">{copied === id ? messages.load_problemIdCopied() : ''}</span>
    </div>
  )
}

/** Router failures include loader, transport and server-render errors. */
function RouteError({ fullscreen = false }: { fullscreen?: boolean }) {
  const error = useRouteError()
  const describe = useLoadFailure()
  const location = useLocation()
  const navigate = useNavigate()
  const navigation = useNavigation()
  const failure =
    error instanceof RenderResponseError
      ? describe.of({ _tag: error.status === 500 ? 'ROUTE_FAILED' : 'SERVICE_UNAVAILABLE' })
      : isRouteErrorResponse(error)
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
  const active = useRef(false)
  const mounted = useRef(false)
  const [working, setWorking] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [browserId, setBrowserId] = useState<string>()
  const recorded = useRef<{ readonly error: unknown; readonly id: string } | undefined>(undefined)
  const requestId = error instanceof RenderResponseError ? error.requestId : undefined
  useEffect(() => {
    if (!shown.retryable) return
    const id =
      requestId ??
      (recorded.current?.error === error ? recorded.current?.id : undefined) ??
      browserProblemId()
    recorded.current = { error, id }
    if (requestId === undefined) setBrowserId(id)
    captureException(error, { problemId: id })
  }, [error, requestId, shown.retryable])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (fullscreen) heading.current?.focus({ preventScroll: true })
  }, [fullscreen])
  const reference = shown.retryable ? (requestId ?? browserId) : undefined
  const retrying = working || navigation.state !== 'idle'
  const retry = () => {
    if (active.current || retrying) return
    active.current = true
    setWorking(true)
    const dwell = new Promise<void>((resolve) => setTimeout(resolve, 350))
    void Promise.allSettled([
      dwell,
      Promise.resolve().then(() =>
        navigate(location, {
          replace: true,
          state: location.state,
          preventScrollReset: true,
        }),
      ),
    ]).then(() => {
      active.current = false
      if (mounted.current) {
        setWorking(false)
        // If this boundary still stands, the retry did not recover it.
        setAttempts((count) => count + 1)
      }
    })
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
                data-retry-shake={attempts > 0 && !retrying ? attempts % 2 : undefined}
                onClick={retry}
              >
                {retrying ? (
                  <LoaderCircleIcon aria-hidden width={16} height={16} />
                ) : (
                  <RotateCwIcon aria-hidden width={16} height={16} />
                )}
                {messages.action_retry()}
              </button>
            )}
            <Link to="/" data-emergency-primary={shown.retryable ? undefined : ''}>
              {messages.action_goHome()}
            </Link>
          </div>
          {reference !== undefined && <ProblemReference id={reference} />}
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
        detail={reference === undefined ? undefined : <ProblemReference id={reference} />}
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
