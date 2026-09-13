// the package ships one commonjs-flavored d.ts for both builds, so TS wraps
// the factory in an extra `default` that the esm build vitest actually loads
// does not have; the cast re-aligns the type with the runtime value
import * as stylexUnpluginModule from '@stylexjs/unplugin/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import type { BrowserCommand } from 'vitest/node'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { qualyPlugins, qualyRelease } from '@qualy/web-build/vite'

const stylexUnplugin =
  stylexUnpluginModule.default as unknown as (typeof stylexUnpluginModule)['default']['default']

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

// The one media feature a test may change: the context asks for reduced
// motion (below), and a test about motion itself has to be able to ask for
// the opposite for its own duration and put it back.
const emulateMedia: BrowserCommand<[{ reducedMotion: 'reduce' | 'no-preference' }]> = async (
  { page },
  media,
) => {
  await page.emulateMedia(media)
}

// Component tests run in a real browser rather than a simulated dom. What
// this project's screens actually get wrong lives in the gap between the
// two: router navigation, focus, native form submission, <dialog>, lazy
// chunks and the query string. Everything else — services, contracts,
// authorization — stays in the node suite, which must not pay for a browser.
export default defineConfig({
  // the app that OWNS react. With the repo root here, dedupe and the react
  // plugin's optimizeDeps resolve react from a package.json that does not
  // declare it - under pnpm isolation that silently fails, and every plugin
  // package loads its own copy: the "Invalid hook call" crash, cold cache only
  root: 'apps/web',
  // StyleX sits before the React plugin, mirroring the production Vite
  // pipeline - a test run that skipped the compiler would assert against
  // unstyled markup and pass vacuously
  plugins: [
    // the suite runs under a development release of its own, and the
    // vitest server answers for it, as the app's dev server does
    qualyRelease(),
    qualyPlugins(),
    stylexUnplugin({
      useCSSLayers: true,
      dev: true,
      runtimeInjection: false,
      // same pinned root as the app pipeline, so defineVars hashes agree
      unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
    }),
    react(),
  ],
  resolve: {
    // one react instance for the host and every plugin component
    dedupe: ['react', 'react-dom'],
  },
  test: {
    include: ['tests/**/*.browser.test.tsx'],
    // One retry, for one diagnosed reason: the runner dispatches real input
    // at page coordinates computed from the tester iframe's offset, and
    // when that offset shifts mid-click the press lands outside the frame -
    // instrumented capture showed zero events reaching the document while
    // click() reported success. A genuine regression fails twice.
    retry: 1,
    // runs in the browser before any test module: pins the cascade layer
    // order the app's index.html pins in production (see that file), and
    // holds each test until the previous one's overlays have left
    setupFiles: ['tests/support/cascade-layers.ts', 'tests/support/settled.ts'],
    browser: {
      enabled: true,
      // the product honors prefers-reduced-motion, and the suite asks for
      // it: a click that lands mid-entrance hits a moving target, and the
      // flake roams with machine load
      provider: playwright({ contextOptions: { reducedMotion: 'reduce' } }),
      headless: true,
      // the screens are asserted styled now, so the window size matters:
      // desktop is the baseline, and a test about the phone layout says so
      // itself with page.viewport()
      viewport: { width: 1280, height: 800 },
      instances: [{ browser: 'chromium' }],
      commands: { emulateMedia },
    },
  },
})
