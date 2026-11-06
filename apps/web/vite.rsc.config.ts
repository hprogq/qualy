// The same application rendered on a server (docs/adr/0012-rsc-data-mode.md).
//
// Beside vite.config.ts, not instead of it, while the page-rendered build
// stays the product's: its own cache, its own output and its own port, so
// neither build rewrites the other's modules or files. Three environments:
// `rsc` resolves a request's surfaces and renders the server components,
// `ssr` draws their answer as html, `client` hydrates it and runs the
// plugins' browser halves.
import * as stylexUnpluginModule from '@stylexjs/unplugin/vite'
import react from '@vitejs/plugin-react'
import rsc from '@vitejs/plugin-rsc'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type PluginOption } from 'vite'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { qualyEnvironmentModules, qualyRelease } from '@qualy/web-build/vite'
import { qualyMessages } from '@qualy/message-build/vite'

const stylexUnplugin =
  stylexUnpluginModule.default as unknown as (typeof stylexUnpluginModule)['default']['default']

/** a plugin, or plugins, kept out of the server component environment */
const withoutServerComponents = (plugin: PluginOption): Plugin[] =>
  [plugin]
    .flat(Infinity as 1)
    .filter((one): one is Plugin => one !== null && typeof one === 'object' && 'name' in one)
    .map((one) => ({
      ...one,
      applyToEnvironment: (environment) => environment.name !== 'rsc',
    }))

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

// where the api answers while this server runs beside the development backend
const apiOrigin =
  process.env['QUALY_RENDER_API_ORIGIN'] ?? `http://127.0.0.1:${process.env['PORT'] ?? '3000'}`

export default defineConfig(({ mode }) => ({
  envDir: false,
  cacheDir: 'node_modules/.vite-rsc',
  plugins: [
    qualyRelease(),
    qualyEnvironmentModules(),
    qualyMessages({ documentLocaleModule: '@qualy/web-rsc/document-locale' }),
    // StyleX where client components are drawn: the html renderer and the
    // page. In the server component environment a client module is replaced
    // by a reference after StyleX has already read it, so its rules would
    // name constants nothing there defines; no server component styles
    // anything yet, and how one would is a question this slice records.
    ...withoutServerComponents(
      stylexUnplugin({
        useCSSLayers: true,
        dev: mode !== 'production',
        runtimeInjection: false,
        unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
        lightningcssOptions: { minify: mode === 'production' },
      }),
    ),
    react(),
    rsc({
      entries: {
        rsc: './src/rsc/entry.rsc.tsx',
        ssr: './src/rsc/entry.ssr.tsx',
        client: './src/rsc/entry.browser.tsx',
      },
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    sourcemap: 'hidden',
  },
  // each environment's output under this build's own directory: the plugin
  // names them per environment, and left to it they land beside the page
  // build's own output
  environments: {
    rsc: { build: { outDir: 'dist-rsc/rsc' } },
    ssr: { build: { outDir: 'dist-rsc/ssr' } },
    client: { build: { outDir: 'dist-rsc/client' } },
  },
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      [QUALY_API_PREFIX]: { target: apiOrigin, ws: true },
      '/health': { target: apiOrigin },
    },
    fs: {
      allow: [`${repoRoot}apps/web`, `${repoRoot}packages`, `${repoRoot}node_modules`],
    },
  },
}))
