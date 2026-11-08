import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Effect } from 'effect'
import type { HttpApi } from 'effect/http-api'
import type { NamespacedId } from '@qualy/ui-contract'
import type { ClientUnsupportedReason } from '@qualy/release-contract'
import { Toaster } from '@qualy/ui/toast'
import { isAuthenticationError } from '@qualy/web-i18n'
import { captureDiagnostic } from '@qualy/browser-observability'
import {
  appApi,
  RuntimeContext,
  type ClientProvider,
  type Manifest,
  type Runtime,
} from './runtime-context.tsx'
import { staleSlotReference, type LoadSlotReference } from './surfaces/slot-reference.tsx'
import { clientFor, type ClientOf, type ClientIdentity, type TransportOptions } from './data/api.ts'
import {
  adoptDocumentIdentity,
  identityOfManifest,
  onUnasserted,
} from './session/document-identity.ts'
import { identityChanging, presentedManifest, identityRefused } from './session/session-recovery.ts'
import { SessionRecoveryGate } from './session/session-recovery-gate.tsx'
import { LiveChannels, type LiveChannelsOptions } from './live/live-channel.ts'
import { LiveChannelsContext, liveIdentityOf } from './live/live-channel-context.tsx'
import type { ComponentRegistry } from './surfaces/registry.ts'
import { createQueryUtils, retryQuery, retryDelay, type QueryUtils } from './data/api-query.ts'

const SESSION_LOST = Object.assign(new Error('AUTH_REQUIRED'), { _tag: 'AUTH_REQUIRED' })

const openDocument = (href: string, { replace }: { replace: boolean }) => {
  if (replace) window.location.replace(href)
  else window.location.assign(href)
}

/** real clients, one per definition, over one transport carrying the page's identity */
const clientProviderFor = (transport: TransportOptions): ClientProvider => {
  const cache = new WeakMap<object, unknown>()
  return (api: HttpApi.Constraint) => {
    const cached = cache.get(api)
    if (cached) return cached
    const client = Effect.runSync(
      clientFor(api as Parameters<typeof clientFor>[0], undefined, transport),
    )
    cache.set(api, client)
    return client
  }
}

export interface RuntimeProviderProps {
  /** replaced by harnesses; production derives real clients per definition */
  clientFor?: ClientProvider
  /**
   * who the page is, named on every api request. The composition root hands
   * it in from the bundle's own identity; this package imports no virtual
   * module. A harness may leave it out.
   */
  clientIdentity?: ClientIdentity
  /** the server refused this page's protocol: told to whoever blocks the page */
  onClientUnsupported?: (reason: ClientUnsupportedReason) => void
  /** the sign-in page, opened in a tab of its own when a session is lost under a reader */
  signInPage?: NamespacedId
  /** makes the live channels' sockets; a harness brings its own, the page uses its WebSocket */
  webSocket?: LiveChannelsOptions['webSocket']
  /** the live channels' waits, shortened by a harness that cannot wait them out */
  liveTiming?: LiveChannelsOptions['timing']
  registry: ComponentRegistry
  /**
   * The manifest a server rendered this document for. Given, it is the
   * page's manifest as it stands - the server already chose the layouts,
   * pages and slots it names - so nothing is fetched or warmed before the
   * routes render (docs/adr/0012-rsc-data-mode.md).
   */
  manifest: Manifest
  initialWorkspaceCapabilities?: readonly string[] | undefined
  loadSlotReference?: LoadSlotReference | undefined
  /** Opens a new document after an explicit identity change. */
  navigateDocument?:
    | ((href: string, options: { replace: boolean }) => void | Promise<void>)
    | undefined
  children: ReactNode
}

export function RuntimeProvider({
  clientFor: provided,
  clientIdentity,
  onClientUnsupported,
  signInPage,
  webSocket,
  liveTiming,
  registry,
  manifest: rendered,
  initialWorkspaceCapabilities,
  loadSlotReference,
  navigateDocument: navigate = openDocument,
  children,
}: RuntimeProviderProps) {
  const [manifestKey] = useState(() => ({ current: undefined as QueryKey | undefined }))
  const [lost] = useState(() => (error: unknown) => {
    if (identityChanging() || !isAuthenticationError(error)) return
    const before = queryClient.getQueryData<Manifest>(manifestKey.current ?? [])
    if (before !== undefined) presentedManifest(before, { ...before, viewer: 'anonymous' })
  })
  // A page that did not say whose it is cannot go on talking
  // (docs/adr/0013-document-identity.md): told as a page the server will not
  // talk to is, and reported, since only a broken page gets here.
  useEffect(
    () =>
      onUnasserted(() => {
        captureDiagnostic('identity-unasserted')
        onClientUnsupported?.('protocol')
      }),
    [onClientUnsupported],
  )
  const [queryClient] = useState(() => {
    const made: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError: lost }),
      mutationCache: new MutationCache({ onError: lost }),
      defaultOptions: {
        queries: { retry: retryQuery, retryDelay },
        // Never, and stated rather than inherited. A write whose response
        // was lost is indistinguishable here from one that never arrived,
        // so retrying it is a second write nobody asked for - and the
        // window this repeats in is exactly the one where the backend is
        // being replaced mid-request.
        mutations: { retry: false },
      },
    })
    return made
  })
  // One tab's live channels. A channel the server closes for want of a
  // session is a session lost like any request that finds out, and goes to
  // the same handler; a page the server will not talk to goes to whoever
  // blocks the page.
  const [channels] = useState(
    () =>
      new LiveChannels({
        ...(webSocket === undefined ? {} : { webSocket }),
        ...(liveTiming === undefined ? {} : { timing: liveTiming }),
        ...(clientIdentity === undefined ? {} : { clientIdentity }),
        ...(onClientUnsupported === undefined ? {} : { onClientUnsupported }),
        onSessionLost: () => lost(SESSION_LOST),
        onIdentityChanged: identityRefused,
      }),
  )
  const freezeChannels = useCallback(() => channels.freeze(), [channels])
  const navigateDocument = useCallback<Runtime['navigateDocument']>(
    (href, options) => {
      channels.freeze()
      return navigate(href, options)
    },
    [channels, navigate],
  )
  // Not disposed with the provider: a strict-mode remount runs the cleanup of
  // a provider that stays, and would cut every channel its screens hold. A
  // provider that really goes takes its screens with it, and each channel
  // they let go of goes at the end of its grace.
  const [runtime] = useState(() => {
    const provider =
      provided ??
      clientProviderFor({
        ...(clientIdentity === undefined ? {} : { identity: clientIdentity }),
        ...(onClientUnsupported === undefined ? {} : { onClientUnsupported }),
      })
    const utils = new WeakMap<object, unknown>()
    const utilsFor = (api: HttpApi.Constraint) => {
      const cached = utils.get(api)
      if (cached) return cached
      const built = createQueryUtils(provider(api) as Record<string, never>)
      utils.set(api, built)
      return built
    }
    manifestKey.current = (
      utilsFor(appApi) as QueryUtils<ClientOf<typeof appApi>>
    ).app.getManifest.queryOptions().queryKey
    // A rendered document's manifest, where whatever reads the manifest
    // from the cache - the session's recovery - finds it. Placed, not
    // asked: nothing observes it, so nothing refetches it out from under
    // the surfaces the server handed over with it.
    queryClient.setQueryData(manifestKey.current, rendered)
    return {
      clientFor: provider,
      utilsFor,
      // who is signed in, asked straight: the manifest never refuses, and a
      // question about the session must not wait for the session to return
      askManifest: () =>
        Effect.runPromise((provider(appApi) as ClientOf<typeof appApi>).app.getManifest()),
    }
  })
  return (
    <QueryClientProvider client={queryClient}>
      <LiveChannelsContext.Provider value={channels}>
        <RenderedRuntime
          clientFor={runtime.clientFor}
          utilsFor={runtime.utilsFor}
          registry={registry}
          channels={channels}
          manifest={rendered}
          initialWorkspaceCapabilities={initialWorkspaceCapabilities}
          loadSlotReference={loadSlotReference}
          navigateDocument={navigateDocument}
        >
          {children}
        </RenderedRuntime>
      </LiveChannelsContext.Provider>
      {/* mounted once, above every screen: a plugin that wants to say
          something did not have to arrange for somewhere to say it */}
      <Toaster />
      <SessionRecoveryGate
        manifestKey={manifestKey.current ?? []}
        askManifest={runtime.askManifest}
        signInPage={signInPage}
        onFreeze={freezeChannels}
        onLeave={() => {
          const entry = rendered.pages.find((page) => page.id === signInPage)
          void queryClient.cancelQueries().then(() => {
            queryClient.clear()
            return navigateDocument(entry?.path ?? '/', { replace: true })
          })
        }}
      />
    </QueryClientProvider>
  )
}

/**
 * The runtime of a document a server rendered: its manifest arrives with the
 * render, and a navigation that renders again brings the next one with it.
 * The manifest and the surfaces the server handed over are one answer, so
 * nothing here asks for the manifest on its own and replaces half of it.
 */
function RenderedRuntime({
  clientFor,
  utilsFor,
  registry,
  channels,
  manifest,
  initialWorkspaceCapabilities,
  loadSlotReference,
  navigateDocument,
  children,
}: Runtime & { channels: LiveChannels; children: ReactNode }) {
  const queryClient = useQueryClient()
  // the next render's manifest, replacing the last one where the cache holds it
  useEffect(() => {
    const key = (
      utilsFor(appApi) as QueryUtils<ClientOf<typeof appApi>>
    ).app.getManifest.queryOptions().queryKey
    queryClient.setQueryData(key, manifest)
    queryClient.removeQueries({
      predicate: ({ queryKey }) => staleSlotReference(queryKey, manifest),
    })
  }, [queryClient, utilsFor, manifest])
  const liveIdentity = liveIdentityOf(manifest)
  useEffect(() => {
    channels.retain(liveIdentity)
  }, [channels, liveIdentity])
  // the document is the person's the server rendered it for, and says so on
  // every request it makes (document-identity.ts)
  adoptDocumentIdentity(identityOfManifest(manifest))
  return (
    <RuntimeContext.Provider
      value={{
        clientFor,
        utilsFor,
        registry,
        manifest,
        initialWorkspaceCapabilities,
        loadSlotReference,
        navigateDocument,
      }}
    >
      {children}
    </RuntimeContext.Provider>
  )
}
