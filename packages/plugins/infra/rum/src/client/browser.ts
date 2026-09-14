import type { BrowserPlugin } from '@qualy/plugin-kit/browser'

// The capability's own browser half: ask this deployment whether it reports,
// and through whom.
//
// It was the composition root that did this - the last line of apps/web that
// named a plugin - because nothing gave a browser plugin a moment to run in.
// This is that moment.
//
// `start`, and the import is dynamic, for the same reason the two halves of
// this package were split in the first place: asking the server costs an api
// client, 128 KB of schema and http machinery, and this module is evaluated
// by every page of every deployment that has reporting active. A static
// import here would have put all of it on the cold path - which the browser
// graph gate caught the moment it was written. The start phase is where
// something may cost something, and nothing waits for it.

const plugin: BrowserPlugin = {
  start: async (context) => {
    const { startBrowserRum } = await import('./start.ts')
    await startBrowserRum({ releaseId: context.release.releaseId })
  },
}

export default plugin
