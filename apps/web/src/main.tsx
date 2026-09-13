import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { webRelease } from 'virtual:qualy/release'
import App from './App.tsx'
import './app.css'

// the release this page runs, on the root: public diagnostic, and what a
// deployment's acceptance reads to know which build a tab is on
document.documentElement.dataset['release'] = webRelease.releaseId

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
