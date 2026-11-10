import { prepareDocumentEntrance } from '../document/entrance.ts'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRevalidator } from 'react-router'
import { useManifest, useRuntime } from '../runtime-context.tsx'
import { sessionDestinationHref, type SessionDestination } from '../routing/pages.ts'
import { signingOut } from './identity.ts'
import { changingIdentity, announceSessionChanged } from './session-recovery.ts'
import { useUnguardedMove } from '../routing/leave-guard.tsx'

/** Refresh the authorized projection and surfaces together through the router. */
export function useManifestRefresh(): () => Promise<void> {
  const { revalidate } = useRevalidator()
  return useCallback(async () => {
    await revalidate()
  }, [revalidate])
}

/** A new identity always opens a new document and gets a fresh query cache. */
export function useSessionTransition() {
  const queryClient = useQueryClient()
  const manifest = useManifest()
  const { navigateDocument } = useRuntime()
  const unguarded = useUnguardedMove()
  return useCallback(
    async (options: { destination: SessionDestination; replace?: boolean }) => {
      const changed = changingIdentity()
      try {
        if (manifest.viewer === 'authenticated') signingOut()
        await queryClient.cancelQueries()
        const href = sessionDestinationHref(options.destination, manifest.pages)
        await unguarded(() => {
          prepareDocumentEntrance(href)
          return navigateDocument(href, { replace: options.replace ?? true })
        })
      } finally {
        changed()
        announceSessionChanged()
      }
    },
    [queryClient, manifest, navigateDocument, unguarded],
  )
}
