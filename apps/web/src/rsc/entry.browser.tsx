import '@qualy/browser-observability/bootstrap'
import { createFromReadableStream } from '@vitejs/plugin-rsc/browser'
import { startTransition, StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import {
  unstable_getRSCStream as getRSCStream,
  unstable_RSCHydratedRouter as RSCHydratedRouter,
  type unstable_RSCPayload as RSCPayload,
} from 'react-router/dom'
import { startBrowserPlugins } from '@qualy/plugin-kit/browser'
import { browserPlugins } from 'virtual:qualy/browser-plugins'
import { releases, webRelease } from '../release.ts'

// The page's half (docs/adr/0012-rsc-data-mode.md): the same start a
// page-rendered tab makes - the release protocol and the plugins' browser
// halves first - and then the document the server drew is taken over where
// it stands, rather than drawn again.

releases.start()
startBrowserPlugins(browserPlugins, { release: webRelease })

void createFromReadableStream<RSCPayload>(getRSCStream()).then((payload) => {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <RSCHydratedRouter createFromReadableStream={createFromReadableStream} payload={payload} />
      </StrictMode>,
    )
  })
})
