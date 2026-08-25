// the package ships one commonjs-flavored d.ts for both builds, so TS wraps
// the factory in an extra `default` that the esm build vitest actually loads
// does not have; the cast re-aligns the type with the runtime value
import * as stylexUnpluginModule from '@stylexjs/unplugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { qualyPlugins } from '@qualy/web-build/vite'

const stylexUnplugin =
  stylexUnpluginModule.default as unknown as (typeof stylexUnpluginModule)['default']['default']

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

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
  // the root .env, same as the app pipeline: VITE_PRIMEUI_LICENSE reaches
  // the test provider so every Prime mount stops warning about the license
  envDir: repoRoot,
  // StyleX sits before the React plugin, mirroring the production Vite
  // pipeline - a test run that skipped the compiler would assert against
  // unstyled markup and pass vacuously
  plugins: [
    qualyPlugins(),
    stylexUnplugin({
      useCSSLayers: true,
      dev: true,
      runtimeInjection: false,
      // same pinned root as the app pipeline, so defineVars hashes agree
      unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    // one react instance for the host and every plugin component
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Prime subpaths reached only through @qualy/ui adapters: discovered
    // mid-run they trigger a re-optimize that hands some modules a second
    // React instance (the cold-cache invalid-hook crash, again). Every
    // subpath an adapter imports is declared here so the first optimize
    // pass already knows them; extend this list with each migrated widget.
    include: [
      '@primereact/core/config',
      '@primereact/ui/button',
      '@primereact/ui/inputtext',
      '@primereact/ui/textarea',
      '@primereact/ui/checkbox',
      '@primereact/ui/radiobutton',
      '@primereact/ui/radiobuttongroup',
    ],
  },
  test: {
    include: ['tests/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
})
