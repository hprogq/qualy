import type { BrowserPlugin, Dispose } from '@qualy/plugin-kit/browser'

// The capability's own browser half: ask this deployment whether it reports,
// and bring up what answers.
//
// It was the composition root that did this - the last line of apps/web that
// named a plugin - because nothing gave a browser plugin a moment to run in.
// This is that moment.
//
// The asking happens in `start`, and the import is dynamic, for the same
// reason the two halves of this package were split in the first place: asking
// the server costs an api client, 128 KB of schema and http machinery, and
// this module is evaluated by every page of every deployment that has
// reporting active. A static import here would have put all of it on the cold
// path - which the browser graph gate caught the moment it was written. The
// start phase is where something may cost something, and nothing waits for it.
//
// What `setup` does is hold the lifetime. The host does not await `start`, so
// the teardown it collects cannot be the one `start` produces; but what start
// leaves behind - a sink installed into the platform - outlives the call and
// has to come back out. So the disposer arrives late, into a holder the
// teardown already owns.
//
// The race is why this is a holder and not an assignment: a lifetime can end
// while the answer is still in flight. Then the sink would install into a page
// whose reporting was already torn down, and the next module instance would
// install a second one beside it. Every development reload is that race, so
// the holder says whether it is still wanted, and a sink that arrives too late
// is disposed of rather than kept.

/** this page's reporting, and whether it is still wanted */
const lifetime: { stopped: boolean; dispose: Dispose | undefined } = {
  stopped: false,
  dispose: undefined,
}

const plugin: BrowserPlugin = {
  setup() {
    // a lifetime begins here, so a previous one's ending does not reach into it
    lifetime.stopped = false
    lifetime.dispose = undefined
    return () => {
      lifetime.stopped = true
      lifetime.dispose?.()
      lifetime.dispose = undefined
    }
  },

  start: async (context) => {
    const { startBrowserRum } = await import('./start.ts')
    const dispose = await startBrowserRum({ releaseId: context.release.releaseId })
    if (lifetime.stopped) dispose()
    else lifetime.dispose = dispose
  },
}

export default plugin
