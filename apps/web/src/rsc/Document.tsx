'use client'
import { useRevalidator } from 'react-router'
import { useEffect, useMemo, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import type { SupportedLocale } from '@qualy/i18n-contract'
import {
  DataRouterLeaveGuard,
  DocumentNow,
  RuntimeProvider,
  RouteMetadata,
  emptyComponentRegistry,
  type ComponentRegistry,
  type Manifest,
} from '@qualy/web-runtime'
import { SIGN_IN_PAGE } from '@qualy/auth-contract/sign-in-failure'
import { releases, webRelease } from '../release.ts'
import { browserSlotLoader } from './slot-reference.ts'
import { NavigationProgress } from './navigation-progress.tsx'

function DevelopmentRenderRefresh() {
  const { revalidate } = useRevalidator()
  useEffect(() => {
    const hot = import.meta.hot
    if (hot === undefined) return
    const refresh = () => void revalidate()
    hot.on('rsc:update', refresh)
    return () => hot.off('rsc:update', refresh)
  }, [revalidate])
  return null
}

export function Document({
  manifest,
  slots,
  locale,
  renderedAt,
  hydration,
  initialWorkspaceCapabilities,
  children,
}: {
  manifest: Manifest
  slots: Readonly<Record<string, Readonly<Record<string, ComponentType<any>>>>>
  locale: SupportedLocale
  /** the moment the server drew this document */
  renderedAt: number
  /** what the page read first on the server, for every surface's queries */
  hydration?: ComponentProps<typeof QueryHydration>['state'] | undefined
  initialWorkspaceCapabilities?: readonly string[] | undefined
  children: ReactNode
}) {
  const registry = useMemo<ComponentRegistry>(
    () => ({ ...emptyComponentRegistry(), slots }),
    [slots],
  )
  const loadSlotReference = useMemo(() => browserSlotLoader(locale), [locale])
  return (
    <DocumentNow at={renderedAt}>
      <RuntimeProvider
        registry={registry}
        manifest={manifest}
        loadSlotReference={loadSlotReference}
        initialWorkspaceCapabilities={initialWorkspaceCapabilities}
        clientIdentity={webRelease}
        onClientUnsupported={(reason) => releases.notifyClientUnsupported(reason)}
        signInPage={SIGN_IN_PAGE}
      >
        <DataRouterLeaveGuard>
          {import.meta.env.DEV && <DevelopmentRenderRefresh />}
          <NavigationProgress />
          <RouteMetadata>
            {hydration === undefined ? (
              children
            ) : (
              <QueryHydration state={hydration}>{children}</QueryHydration>
            )}
          </RouteMetadata>
        </DataRouterLeaveGuard>
      </RuntimeProvider>
    </DocumentNow>
  )
}
