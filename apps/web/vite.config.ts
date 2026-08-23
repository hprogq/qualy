import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { qualyPlugins } from '@qualy/web-build/vite'

export default defineConfig({
  plugins: [qualyPlugins(), react(), tailwindcss()],
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
    allowedHosts: ['qualy-dev.hprogq.com'],
  },
})
