/** A request failed before the renderer returned an HTTP response. */
export class RenderNetworkError extends Error {
  constructor(cause: unknown) {
    super('The render request could not reach the server', { cause })
    this.name = 'RenderNetworkError'
  }
}
