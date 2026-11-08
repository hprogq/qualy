// The application, drawn on a server (docs/adr/0012-rsc-data-mode.md).
//
// Three environments: `rsc` resolves a request's surfaces and renders the
// server components,
// `ssr` draws their answer as html, `client` hydrates it and runs the
// plugins' browser halves.
import * as stylexUnpluginModule from '@stylexjs/unplugin/vite'
import react from '@vitejs/plugin-react'
import rsc from '@vitejs/plugin-rsc'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type PluginOption } from 'vite'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { qualyEnvironmentModules, qualyRelease } from '@qualy/web-build/vite'
import { qualyChunkGraph } from '../../packages/build/web/src/chunk-graph.ts'
import { chunkPools } from './chunk-pools.ts'
import {
  DOCUMENT_HOST_MODULES,
  documentBootBrotliBudget,
  documentBudgets,
  documentEntryBrotliBudget,
} from './document-budget.ts'
import { qualyMessages } from '@qualy/message-build/vite'

const stylexUnplugin =
  stylexUnpluginModule.default as unknown as (typeof stylexUnpluginModule)['default']['default']

/** whether a module opens with the client directive, past its comments */
const CLIENT_DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use client\1/

/**
 * A transform that, in the server component environment, leaves client
 * modules alone.
 *
 * There a client module is replaced by a reference to itself; the html
 * renderer and the page compile it where it actually runs. Compiled here as
 * well, its rules named constants nothing in this environment defines. A
 * server component's own module - one that never reaches a browser - is
 * compiled here and nowhere else, so its rules join the stylesheet every
 * document links.
 */
const serverModulesInServerComponents = (plugin: PluginOption): Plugin[] =>
  [plugin]
    .flat(Infinity as 1)
    .filter((one): one is Plugin => one !== null && typeof one === 'object' && 'name' in one)
    .map((one) => {
      const hook = one.transform
      if (hook === undefined) return one
      const handler = typeof hook === 'function' ? hook : hook.handler
      const transform = function (
        this: { environment?: { name: string } },
        code: string,
        ...rest: unknown[]
      ) {
        if (this.environment?.name === 'rsc' && CLIENT_DIRECTIVE.test(code)) return null
        return (handler as (...args: unknown[]) => unknown).call(this, code, ...rest)
      }
      return {
        ...one,
        transform: typeof hook === 'function' ? transform : { ...hook, handler: transform },
      } as Plugin
    })

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

// Public names identify bytes, never the plugin or component that produced
// them; the entry stylesheet has a role of its own, so StyleX can append its
// rules to the one every page loads. The server's two environments name
// their assets the same way: a file a server half links - the face a
// document preloads - is the browser build's own file of the same bytes, so
// the name a document writes is a name the store serves.
const assetFileNames = (info: { readonly names?: readonly string[] }) =>
  info.names?.includes('entry.css') ? 'assets/s-[hash][extname]' : 'assets/a-[hash][extname]'

// where the api answers while this server runs beside the development backend
const apiOrigin =
  process.env['QUALY_RENDER_API_ORIGIN'] ?? `http://127.0.0.1:${process.env['PORT'] ?? '3000'}`

export default defineConfig(({ command, mode }) => ({
  envDir: false,
  cacheDir: 'node_modules/.vite-rsc',
  plugins: [
    qualyRelease(),
    qualyEnvironmentModules(),
    qualyMessages({ documentLocaleModule: '@qualy/web-rsc/document-locale' }),
    // StyleX wherever components are drawn: a client component in the html
    // renderer and the page, a server component in its own environment
    ...serverModulesInServerComponents(
      stylexUnplugin({
        useCSSLayers: true,
        dev: mode !== 'production',
        runtimeInjection: false,
        unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
        // Into the stylesheet every document links, as the page build does
        // for its shell: left to the plugin, the rules went to whichever
        // stylesheet came first, one page's lazy one, and every other page
        // drew unstyled.
        cssInjectionTarget: (file) => /(^|[\\/])s-[^\\/]*\.css$/.test(file),
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
    // The browser's half fails here, rather than in a visitor's browser,
    // when its chunks import one another or a document grows past what it
    // was measured at (chunk-graph.ts).
    {
      ...qualyChunkGraph({
        root: repoRoot,
        bootBudget: 2 * 1024 * 1024,
        entryBrotliBudget: documentEntryBrotliBudget,
        bootBrotliBudget: documentBootBrotliBudget,
        screens: documentBudgets,
        hostModules: DOCUMENT_HOST_MODULES,
      }),
      applyToEnvironment: (environment) => environment.name === 'client',
    },
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
  //
  // A build's two server halves carry every package they run, so the image
  // that serves them needs their files and nothing from node_modules: the
  // executable code a server runs is fixed with the image it ships in, never
  // resolved from a tree beside it. A development server keeps them external,
  // where the optimizer handles them.
  environments: {
    rsc: {
      build: { outDir: 'dist-rsc/rsc', rollupOptions: { output: { assetFileNames } } },
      ...(command === 'build' ? { resolve: { noExternal: true } } : {}),
    },
    ssr: {
      build: { outDir: 'dist-rsc/ssr', rollupOptions: { output: { assetFileNames } } },
      ...(command === 'build' ? { resolve: { noExternal: true } } : {}),
      // These packages export hundreds of modules from their entry points.
      // Bundle them in the HTML renderer's own optimizer (not the React
      // server environment) instead of transforming each file on first view.
      optimizeDeps: {
        include: [
          'lucide-react',
          '@qualy/ui > @mantine/core',
          '@qualy/ui > @mantine/dates',
          '@qualy/ui > @mantine/hooks',
        ],
      },
    },
    client: {
      build: {
        outDir: 'dist-rsc/client',
        rollupOptions: {
          output: {
            // Public names identify bytes, never the plugin or component
            // that produced them. The entry stylesheet has a role of its
            // own so StyleX can append its rules to the one every page loads.
            entryFileNames: 'assets/e-[hash].js',
            chunkFileNames: 'assets/c-[hash].js',
            assetFileNames,
            codeSplitting: chunkPools,
          },
        },
      },
      optimizeDeps: {
        entries: ['src/rsc/entry.browser.tsx'],
        // Loaded by the router's Flight references, outside static imports.
        include: ['react-router/internal/react-server-client'],
      },
    },
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/w-[hash].js',
        chunkFileNames: 'assets/w-[hash].js',
        assetFileNames: 'assets/a-[hash][extname]',
      },
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      [QUALY_API_PREFIX]: { target: apiOrigin, ws: true },
      '/health': { target: apiOrigin },
    },
    // It listens beyond this machine, so what it reads is what whoever
    // reaches it can read: the application, the workspace packages and the
    // installed dependencies, and none of the secrets or dumps that may sit
    // among them (tools/tests/dev-server-files.test.ts).
    fs: {
      allow: [`${repoRoot}apps/web`, `${repoRoot}packages`, `${repoRoot}node_modules`],
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc',
        '.yarnrc.yml',
        '**/.git/**',
        '**/*.env',
        '**/*.dump',
      ],
    },
  },
}))
