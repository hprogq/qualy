// First, before the application's own graph: two listeners that hold whatever
// fails while the rest of this file's imports are still evaluating. A
// reporting provider cannot exist that early - it needs a request and a chunk -
// and a module that throws on the way in is exactly the failure worth keeping.
import '@qualy/browser-observability/bootstrap'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'
import { captureDiagnostic } from '@qualy/browser-observability'
// The one line of this file that names a plugin. Asking the assembly whether
// it reports, and through whom, is the reporting capability's own question -
// but nothing yet gives a browser plugin a moment to run in, so the
// composition root still calls it. That is what `Browser.module()` and its
// start hook are for; until then this stays, and the platform's port above
// is what every other file uses.
import { startBrowserRum } from '@qualy/plugin-rum/client/start'
import App from './App.tsx'
import { releases, webRelease } from './release.ts'
import { ReleaseRecoveryGate } from './release-ui.tsx'
import './app.css'

// the release this page runs, on the root: public diagnostic, and what a
// deployment's acceptance reads to know which build a tab is on
document.documentElement.dataset['release'] = webRelease.releaseId

// The page's side of the release protocol, started before anything renders:
// it hears a chunk failing to load from the first navigation on, and the
// gate it feeds stands above every provider, so it can take the page over
// when nothing below it can be counted on.
releases.start()

// Two of the coordinator's verdicts say something went wrong rather than
// something moved on, and both are worth knowing about in aggregate: a tab
// forced to reload because the store no longer keeps its release says
// something about retention, and one refused by protocol says a deployment
// went out that old tabs cannot talk to. An update being available is neither,
// and a chunk that failed to load is already reported as the resource failure
// it is, so neither is sent. Once per reason: a page that cannot go on will
// keep saying so.
let told = ''
releases.subscribe(() => {
  const state = releases.getSnapshot()
  if (state.kind !== 'reload-required') return
  if (state.reason === 'asset-load-failed' || told === state.reason) return
  told = state.reason
  captureDiagnostic(state.reason)
})

// Not awaited, and deliberately before the first render rather than after: the
// browser modules have already registered whatever providers this build
// carries, and nothing on the screen waits for the answer.
void startBrowserRum(webRelease)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReleaseRecoveryGate coordinator={releases} copy={bootstrapMessages}>
      <App />
    </ReleaseRecoveryGate>
  </StrictMode>,
)
