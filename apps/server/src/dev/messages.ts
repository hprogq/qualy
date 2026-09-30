import { compileMessages } from '@qualy/message-build'

// A backend in development compiles the messages before it loads them, as the
// dev server does before it serves a page (docs/adr/0011-i18n-paraglide.md).
// Both read the same packages' messages/*.json and write the same output a
// whole file at a time, so whichever runs second finds nothing to do. The
// layout is the dev server's, one module per locale, so neither rewrites what
// the other just wrote.
export const compileForDevelopment = async (manifestPath: string): Promise<void> => {
  await compileMessages({ manifestPath, outputStructure: 'locale-modules' })
}
