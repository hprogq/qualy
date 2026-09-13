import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReleaseRecoveryGate coordinator={releases} copy={bootstrapMessages}>
      <App />
    </ReleaseRecoveryGate>
  </StrictMode>,
)
