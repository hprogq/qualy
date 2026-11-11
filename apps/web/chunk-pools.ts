import type { Rolldown } from 'vite'

// How the browser's chunks are pooled (vite.rsc.config.ts), decided by what
// a request costs.
//
// Splitting is not free the way it looks in a `dist` listing. On the
// link a phone actually has, a request costs a round trip whatever it
// carries, and over HTTP/1.1 only six are in flight at once - so a
// chunk under a kilobyte is almost entirely latency. Opening the
// batch list asked
// for 61 files; 22 of them were under 2 KB and held 13 KB between
// them.
/** where a pool of messages several pages say is merged into its nearest neighbour */
export const MESSAGE_POOL_BYTES = 48 * 1024

export const chunkPools: NonNullable<Rolldown.OutputOptions['codeSplitting']> = {
  groups: [
    // The typed transport's schemas and implementation have no UI imports.
    // Keep those mutually dependent leaves together without pulling widgets
    // or query observers into the bootstrap graph.
    {
      name: 'platform-api',
      test: /[\\/](?:node_modules[\\/]effect[\\/]|packages[\\/](?:core[\\/](?:api-kit|text)|contracts[\\/](?:app|auth|i18n|release|ui))[\\/]src[\\/])/,
      priority: 3,
      includeDependenciesRecursively: false,
    },
    // Query's providers and observers are one document-level dependency.
    // They import no product module and can share a stable vendor chunk.
    {
      name: 'query',
      test: /[\\/](?:node_modules[\\/]@tanstack[\\/](?:query-core|react-query)[\\/]|packages[\\/]web[\\/]runtime[\\/]src[\\/]data[\\/]query(?:-hydration)?\.tsx?$)/,
      priority: 3,
      includeDependenciesRecursively: false,
    },
    // The formatter, its two locales and zone adapter are one leaf of the
    // graph. Keep them together without drawing the calendar widgets in.
    {
      name: 'date-format',
      test: /[\\/](?:node_modules[\\/](?:date-fns|@date-fns[\\/]tz)[\\/]|packages[\\/]core[\\/]date-format[\\/]src[\\/])/,
      priority: 3,
      includeDependenciesRecursively: false,
    },
    // Presentation primitives and their shared contexts are one foundation.
    // The shared document clock, band context and overlay bookkeeping
    // are also leaves; these should not be three more requests per screen.
    // Product surfaces and the providers that use them remain outside it.
    {
      name: 'document-foundation',
      test: /[\\/]packages[\\/]web[\\/](?:brand[\\/]src[\\/]|ui[\\/]src[\\/](?:theme[\\/]|lib[\\/](?:heading-rank|visually-hidden|veil|xstyle|overlay-motion|panel|layout-preference-spec|inert-background)\.|hooks[\\/](?:use-hydrating|use-mobile)\.|components[\\/](?:spinner|portal|at-width|avatar|badge|field-fill|screen[\\/]band-foot|layout-preferences|page-container|pager|popover|reveal|skeleton|ticker|toggle-group|tooltip)\.)|runtime[\\/]src[\\/](?:shared-context|runtime-context|routing[\\/](?:links|navigation(?:-progress)?)|document[\\/](?:entrance|page-title|document-now|screen-aside|screen-fill|screen-foot|subject|workspace-capabilities))\.tsx?$)/,
      priority: 4,
      includeDependenciesRecursively: false,
    },
    // The batch workspace always needs these leaves for the timeline:
    // labels, date ranges and the event the deadline dock uses to open it.
    // The drawer and its action descriptions can still load separately.
    {
      name: 'batch-timeline',
      test: /[\\/]assessment[\\/]core[\\/]src[\\/]client[\\/]batch[\\/](?:flow|flow-request|when)\.ts$/,
      priority: 3,
      includeDependenciesRecursively: false,
    },
    {
      name: 'motion',
      // Include the motion/react facade rather than serving its re-export
      // as a separate request in addition to the implementation it names.
      test: /[\\/]node_modules[\\/](?:motion|framer-motion|motion-dom|motion-utils)[\\/]/,
      priority: 3,
      includeDependenciesRecursively: false,
    },
    // The icons in two pools. Each is a few hundred bytes, and pooled
    // by which entries draw it every icon was a chunk of its own: 51
    // of the 53 that held one were under 2 KB, and they were a fifth
    // of what the batch overview asked for. One pool of them all went
    // into the boot, since the boot draws a few, and cost every first
    // load, sign-in included, 7 KB Brotli more. So the icons the boot
    // draws (`$initial`) pool by themselves and the rest pool apart:
    // the boot is what it was, and a page pays one request where it
    // paid twenty. An icon imports only the library's own factory and
    // React, so neither pool closes a ring.
    {
      name: 'boot-icons',
      test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
      tags: ['$initial'],
      priority: 5,
      includeDependenciesRecursively: false,
    },
    {
      name: 'icons',
      test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
      priority: 4,
      includeDependenciesRecursively: false,
    },
    // The widget library in one pool. Its modules import one another in
    // rings - a context made in one file and read in the next - which
    // an ESM graph tolerates module by module but not chunk by chunk:
    // pooled below by which entries reach them, they landed in two
    // chunks that import each other, and whichever ran second read
    // the first's `var`s before that chunk had run. The shell threw
    // before it drew, in production only; nothing that fetches the
    // bundle without executing it could see it. One pool, no ring.
    // Less the date pickers, which no first screen draws: pooled with
    // the rest, every page's first load carried them. They import
    // the widgets and nothing imports them back, so the two pools
    // form no ring.
    {
      name: 'dates',
      test: /[\\/]node_modules[\\/]@mantine[\\/]dates[\\/]/,
      priority: 3,
      // what they import stays with the widgets, which every screen has
      includeDependenciesRecursively: false,
    },
    {
      name: 'widgets',
      test: /[\\/]node_modules[\\/]@mantine[\\/]/,
      priority: 2,
    },
    // The compiled messages (docs/adr/0011-i18n-paraglide.md): one
    // module per message, each where the code that says it is. One a
    // single entry says stays in that entry's chunk; one several say
    // is pooled by which entries say it, and the pools under the
    // threshold join their nearest neighbour - otherwise every
    // combination of pages became a chunk of a few hundred bytes. A
    // message imports nothing that imports it back, so pooling them
    // can close no ring.
    //
    // The messages the boot says pool apart first. Merging picks a
    // neighbour by size, not by who reads it, and the boot's pool
    // was one: the first screen every visitor loads,
    // the sign-in page included, carried the account, people picker
    // and user administration messages with it.
    {
      name: 'boot-messages',
      test: /[\\/]\.qualy[\\/](?:i18n(?:-profiles)?[\\/]|messages\.js$)/,
      tags: ['$initial'],
      priority: 2,
      minShareCount: 2,
      includeDependenciesRecursively: false,
    },
    {
      name: 'messages',
      test: /[\\/]\.qualy[\\/](?:i18n(?:-profiles)?[\\/]|messages\.js$)/,
      priority: 1,
      minShareCount: 2,
      entriesAware: true,
      entriesAwareMergeThreshold: MESSAGE_POOL_BYTES,
      includeDependenciesRecursively: false,
    },
    // The dust the automatic splitter leaves: an icon re-export, a
    // one-line wrapper, `cn`. Reached by two page chunks, each became
    // a chunk. `entriesAware` keeps the pooling honest - modules are
    // grouped by WHICH entries reach them, so a page still does not
    // download another page's code.
    //
    // The kilobyte ceiling is what keeps this from becoming a vendor
    // chunk. Raise it and larger shared modules pool with the boot
    // graph, which buys the saved requests with first paint: measured
    // at 4 KB the boot wave costs 600 ms more.
    //
    // Pools are NOT merged into a neighbour, however small. Merging
    // (it was 48 KB) is what produced both failures of v0.1.0-rc.2 and
    // rc.3: two sets of chunks that imported one another, one of which
    // broke every page after sign-in for a browser that fetched them
    // in the other order, and the shell's one-kilobyte modules folded
    // into the formula editor's chunk, so every first screen carried
    // the editor's 2.7 MB. It moves with the code, too - measured on
    // one tree, 4 KB and 8 KB each left a ring and 8 KB brought the
    // editor back. Unmerged, the first screen is 394 KB compressed
    // instead of 1124, for 25 files instead of 16, and a page asks
    // for a median of 28 more instead of 9: requests that HTTP/2
    // sends side by side on one connection, which is how production
    // is served. qualyChunkGraph fails the build on either
    // failure, so trading requests back for bytes is a measurement
    // and a green build, not a guess.
    {
      name: 'shared',
      // Let tiny pools follow automatic chunking instead of turning
      // a constant into its own request. Keep larger pools unmerged.
      minSize: 512,
      minShareCount: 2,
      maxModuleSize: 1024,
      entriesAware: true,
      entriesAwareMergeThreshold: 0,
    },
  ],
}
