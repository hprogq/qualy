import { channel } from 'node:diagnostics_channel'

export interface RenderCorrelation {
  readonly requestId?: string | undefined
  readonly traceId?: string | undefined
}

export type RenderDiagnostic = RenderCorrelation &
  (
    | {
        readonly level: 'error'
        readonly phase: 'document' | 'response' | 'flight' | 'html' | 'late-read'
        readonly fault: string
      }
    | { readonly level: 'warn'; readonly droppedCookies: number }
  )

// The RSC and HTML runners are separate module graphs, also in development.
// A process-local channel reaches their host without replacing its console
// or passing a logger through the React tree.
const render = channel('qualy.web.render')

export const publishRenderDiagnostic = (event: RenderDiagnostic): void => render.publish(event)

export const subscribeRenderDiagnostics = (receive: (event: RenderDiagnostic) => void) => {
  const listener = (event: unknown) => receive(event as RenderDiagnostic)
  render.subscribe(listener)
  return () => render.unsubscribe(listener)
}

export const reportRenderFailure = (
  phase: Extract<RenderDiagnostic, { level: 'error' }>['phase'],
  error: unknown,
  correlation: RenderCorrelation = {},
): void => {
  // Error messages, stacks and query keys can contain private API data.
  let fault = 'UnknownError'
  if (typeof error === 'object' && error !== null) {
    for (const key of ['_tag', 'code', 'name'] as const) {
      const value = (error as Record<string, unknown>)[key]
      if (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value)) {
        fault = value
        break
      }
    }
  }
  publishRenderDiagnostic({ ...correlation, level: 'error', phase, fault })
}
