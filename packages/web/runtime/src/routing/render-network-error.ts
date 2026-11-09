/** A request failed before the renderer returned an HTTP response. */
export class RenderNetworkError extends Error {
  constructor(cause: unknown) {
    super('The render request could not reach the server', { cause })
    this.name = 'RenderNetworkError'
  }
}

/** A server-minted correlation id is opaque; never copy arbitrary header text. */
export const renderRequestId = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
    ? value
    : undefined

export class RenderResponseError extends Error {
  readonly status: number
  readonly requestId: string | undefined
  constructor(status: number, requestId: string | undefined) {
    super('The renderer returned an unsuccessful response')
    this.name = 'RenderResponseError'
    this.status = status
    this.requestId = requestId
  }
}
