// A request that answers 200 at once, recording what reporting already knew
// about its address when it was opened. Shared by the upload route suites.

export interface Opened {
  readonly url: string
  readonly claimed: string | undefined
}

export const installImmediateRequests = (
  routeFor: (path: string, method?: string) => string | undefined,
): Opened[] => {
  const opened: Opened[] = []
  class ImmediateRequest {
    readonly upload = { addEventListener: () => {} }
    status = 0
    private readonly listeners = new Map<string, () => void>()
    open(_method: string, url: string) {
      opened.push({ url, claimed: routeFor(url, 'PUT') })
    }
    setRequestHeader() {}
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener)
    }
    abort() {}
    send() {
      this.status = 200
      queueMicrotask(() => this.listeners.get('load')?.())
    }
  }
  globalThis.XMLHttpRequest = ImmediateRequest as unknown as typeof XMLHttpRequest
  return opened
}

/** every module the page has fetched whose address ends with this */
export const fetched = (suffix: string): number =>
  performance
    .getEntriesByType('resource')
    .filter((entry) => new URL(entry.name).pathname.endsWith(suffix)).length
