// The commands vitest.browser.config.ts registers, as the tests see them.
// The export makes this a module, so the declaration below augments
// vitest's own rather than replacing it.
declare module 'vitest/browser' {
  interface BrowserCommands {
    emulateMedia(media: { reducedMotion: 'reduce' | 'no-preference' }): Promise<void>
  }
}

export {}
