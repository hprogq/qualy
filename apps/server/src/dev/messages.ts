import { compileMessages } from '@qualy/message-build'

// A backend in development compiles the default locale-module tree before it
// loads it. Vite writes browser modules into source-and-layout-specific
// profiles, so a build and a dev server cannot replace files while another
// process still consumes them (docs/adr/0011-i18n-paraglide.md).
export const compileForDevelopment = async (manifestPath: string): Promise<void> => {
  await compileMessages({ manifestPath, outputStructure: 'locale-modules' })
}
