// the package ships one commonjs-flavored d.ts for both builds, so TS wraps
// the factory in an extra `default` that the esm build vite actually loads
// does not have; the cast re-aligns the type with the runtime value
import * as stylexUnpluginModule from '@stylexjs/unplugin/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import {
  qualyBootFrame,
  qualyChunkGraph,
  qualyPlugins,
  qualyRelease,
  qualyShellStyle,
} from '@qualy/web-build/vite'
import { qualyMessages } from '@qualy/message-build/vite'
import { bootBrotliBudget, entryBrotliBudget, screenBudgets } from './performance-budget.ts'
import { chunkPools } from './chunk-pools.ts'

const stylexUnplugin =
  stylexUnpluginModule.default as unknown as (typeof stylexUnpluginModule)['default']['default']

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => ({
  // This build reads no `.env`, and says so.
  //
  // Nothing here uses `import.meta.env` beyond the four Vite defines itself -
  // the shell's configuration arrives from the server at runtime, not baked
  // into a bundle - so there is nothing for an env file to supply. Saying
  // `false` rather than leaving the default also takes those paths out of the
  // dev server's watch list: Vite watches every file `envDir` would name and
  // RESTARTS itself when one changes, and `.env` in this repository can be a
  // pipe a secret manager mounts. A restart loop around a pipe is not a thing
  // to leave to a default nobody has read.
  envDir: false,

  // StyleX must transform each file before the React plugin sees it. The
  // completed Mantine pivot is recorded in docs/archive/designs/mantine-ui-migration.md.
  plugins: [
    // the release this build or dev session is: named once, written into
    // the bundle and beside it, answered at /__qualy/release in dev
    qualyRelease(),
    qualyPlugins(),
    // every package's messages, compiled before anything resolves #messages
    qualyMessages(),
    // the first frame, and beside it what the shell says when nothing of the
    // application ever runs - from the same table the cold start reads
    qualyBootFrame({
      copy: async () => (await import('@qualy/web-i18n/bootstrap')).bootstrapMessages,
    }),
    // and a built shell that fetches its stylesheet without holding that
    // frame for it
    qualyShellStyle(),
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
      // entry's own stylesheet is the one the shell links, and it is named
      // for this above.
      cssInjectionTarget: (file) => /(^|[\\/])s-[^\\/]*\.css$/.test(file),
      // The append happens in `generateBundle`, after Vite has already
      // minified the css it produced - so the compiled rules went out
      // pretty-printed on the end of a minified file, ninety-nine kilobytes
      // of it. The plugin runs its own Lightning CSS pass over them and sets
      // no `minify`, so this is the pass to ask.
      lightningcssOptions: { minify: mode === 'production' },
    }),
    react(),
    // A build whose chunks import one another, or whose first screen grew
    // past this, fails here rather than in a visitor's browser. The first
    // screen weighed 1.4 MiB before compression when this was set; 2 MiB
    // leaves room to grow and none for a library a page should load itself
    // (the formula editor's alone is 2.7 MiB).
    qualyChunkGraph({
      root: repoRoot,
      bootBudget: 2 * 1024 * 1024,
      entryBrotliBudget,
      bootBrotliBudget,
      screens: screenBudgets,
    }),
  ],
  resolve: {
    // one react instance for the host and every plugin chunk
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Plugin scan entries replace Vite's default HTML crawl. Keep the host
    // entry in that crawl too, so its dependencies are known before loading.
    entries: ['index.html'],
  },
  build: {
    // Written, and never pointed at: `hidden` emits the maps without the
    // `sourceMappingURL` comment, so no browser ever asks for one. They are
    // not web assets - a map carries `sourcesContent`, which is the whole
    // source of this product - and the release store refuses to stage them.
    // They travel one way only: from this directory to the reporting
    // platform, by the uploader a release pipeline runs.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        codeSplitting: chunkPools,
        // A public file name says nothing about what is inside it.
        //
        // The default is the module's own basename, so a production
        // deployment served `BatchSettingsPage-<hash>.js` and
        // `FormulaCodeEditor-<hash>.js` - a directory of this product's
        // screens, readable in any browser's network panel by anyone who
        // loads the login page, and a plugin inventory for a deployment that
        // had deliberately stopped publishing one. The content hash already
        // does the only job a name has to do here.
        //
        // `e-` and `c-` rather than nothing at all because the two are told
        // apart by tooling and by whoever reads a manifest of the store; the
        // letter is the kind of file, not what it holds.
        //
        // Stylesheets and fonts go the same way for the same reason: a
        // `FormulaCodeEditor-<hash>.css` names the component just as plainly
        // as the chunk beside it did, and the public half of this product has
        // stopped naming its own parts.
        entryFileNames: 'assets/e-[hash].js',
        chunkFileNames: 'assets/c-[hash].js',
        // The shell's own stylesheet keeps a letter of its own. Not because
        // anything reads a name to know what is inside it, but because one
        // thing has to be able to FIND it: the StyleX plugin appends every
        // compiled rule to one css asset, and it picks that asset by name.
        // It used to look for `index-*.css`, which these opaque names
        // silently stopped producing - so it fell through to "the first css
        // asset in the bundle" and landed on the right one by luck. `s` is
        // the role, not the source.
        assetFileNames: (info) =>
          info.names?.includes('index.css')
            ? 'assets/s-[hash][extname]'
            : 'assets/a-[hash][extname]',
        // a worker is emitted through its own pipeline and does not inherit
        // the three above; the editor's left `editor.worker-<hash>.js` in the
        // open, which names the library a screen is built out of
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
    host: true,
    // stated here rather than left to vite's default, because it is this
    // application's address: the development service in front of the backend
    // refuses to drift off it, and a proxy pointed at nothing looks exactly
    // like a backend that is down
    port: 5173,
    // Vite keeps localhost/IP defaults. A developer's extra hostnames come
    // from __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS in the process environment.
    // What the server hands out under /@fs/. Vite's default is the whole
    // workspace root, and this one also holds database dumps, backups and
    // credentials that are nobody's business on a network the server listens
    // on. The application needs its own directory, the workspace packages
    // and the installed dependencies, nothing else. A deny list given here
    // replaces Vite's own rather than extending it, so that list is repeated
    // in full before the additions.
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
