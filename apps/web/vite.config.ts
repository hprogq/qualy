// the package ships one commonjs-flavored d.ts for both builds, so TS wraps
// the factory in an extra `default` that the esm build vite actually loads
// does not have; the cast re-aligns the type with the runtime value
import * as stylexUnpluginModule from '@stylexjs/unplugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { qualyBootFrame, qualyPlugins } from '@qualy/web-build/vite'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'

const stylexUnplugin =
  stylexUnpluginModule.default as unknown as (typeof stylexUnpluginModule)['default']['default']

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => ({
  // StyleX must transform the file before the React plugin sees it; Tailwind
  // stays until the last migration phase (docs/ui-platform-migration-mantine.md)
  plugins: [
    qualyPlugins(),
    // the first frame, and beside it what the shell says when nothing of the
    // application ever runs - from the same table the cold start reads
    qualyBootFrame({ copy: bootstrapMessages }),
    stylexUnplugin({
      useCSSLayers: true,
      dev: mode !== 'production',
      runtimeInjection: false,
      // defineVars derives variable names from file paths relative to this
      // root; pinned so every pipeline (dev server, test, build) agrees
      // regardless of its working directory
      unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
      // Where the compiled rules go in a production build. The plugin appends
      // them to the stylesheet named index.css or style.css, and failing
      // both to whichever css asset comes first in the bundle; with hashed
      // names neither exists, and the first asset was the formula editor's
      // lazy stylesheet - so every rule of the product rode along with one
      // page nobody had opened yet, and the shell came up unstyled. The
      // entry's own stylesheet is the one the shell links.
      cssInjectionTarget: (file) => /(^|[\\/])index-[^\\/]*\.css$/.test(file),
    }),
    react(),
  ],
  resolve: {
    // one react instance for the host and every plugin chunk
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      output: {
        // How the pieces are pooled, decided by what a request costs.
        //
        // Splitting is not free the way it looks in a `dist` listing. On the
        // link a phone actually has, a request costs a round trip whatever it
        // carries, and only six are in flight at once - so a chunk under a
        // kilobyte is almost entirely latency. Opening the batch list asked
        // for 61 files; 22 of them were under 2 KB and held 13 KB between
        // them.
        codeSplitting: {
          groups: [
            // The widget library, whole. Its modules import one another in
            // rings - a context made in one file and read in the next - which
            // an ESM graph tolerates module by module but not chunk by chunk:
            // pooled below by which entries reach them, they landed in two
            // chunks that import each other, and whichever ran second read
            // the first's `var`s before that chunk had run. The shell threw
            // before it drew, in production only; nothing that fetches the
            // bundle without executing it could see it. One pool, no ring.
            {
              name: 'widgets',
              test: /[\\/]node_modules[\\/]@mantine[\\/]/,
              priority: 2,
            },
            // One locale, one file. Every plugin dynamic-imports its own
            // table for the chosen locale, and all of them are awaited before
            // the first screen - eight requests standing in a row where one
            // would do. Pooled by the locale in the path, so a plugin or a
            // language added later joins its own pool without being named
            // here. Dependencies stay out: these are leaf tables, and pulling
            // their helpers along duplicated 16 KB that shared chunks already
            // carry.
            {
              name: (id) => {
                const locale = /[\\/](?:locales|catalogs)[\\/]([A-Za-z-]+)\.ts$/.exec(id)
                return locale === null ? null : `locale-${locale[1]}`
              },
              priority: 1,
              includeDependenciesRecursively: false,
            },
            // The dust the automatic splitter leaves: an icon re-export, a
            // one-line wrapper, `cn`. Reached by two page chunks, each became
            // a chunk. `entriesAware` keeps the pooling honest - modules are
            // grouped by WHICH entries reach them, so a page still does not
            // download another page's code - and the threshold folds pools
            // too small to be worth a request into the nearest neighbour.
            //
            // The kilobyte ceiling is what keeps this from becoming a vendor
            // chunk. Raise it and larger shared modules pool with the boot
            // graph, which buys the saved requests with first paint: measured
            // at 4 KB the boot wave costs 600 ms more. At 1 KB the boot wave
            // gets slightly smaller and the page needs 32 files instead of
            // 61, for four kilobytes more on the wire.
            {
              name: 'shared',
              minShareCount: 2,
              maxModuleSize: 1024,
              entriesAware: true,
              entriesAwareMergeThreshold: 48 * 1024,
            },
          ],
        },
        // `entriesAware` names each pool after every entry that reaches it,
        // which runs past a hundred characters and is repeated in the shell's
        // preload list and in every importing chunk. The hash already tells
        // them apart.
        chunkFileNames: (chunk) =>
          `assets/${chunk.name.startsWith('shared~') ? 'shared' : chunk.name}-[hash].js`,
      },
    },
  },
  server: {
    host: true,
    // stated here rather than left to vite's default, because it is this
    // application's address: the development service in front of the backend
    // refuses to drift off it, and a proxy pointed at nothing looks exactly
    // like a backend that is down
    port: 5173,
    allowedHosts: ['qualy-dev.hprogq.com'],
  },
}))
