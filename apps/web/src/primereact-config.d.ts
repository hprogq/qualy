import type { ReactNode } from 'react'

// Why this exists: @primereact/core 11.1.0 ships declaration files that TS
// under NodeNext reads in ESM mode (the exports map pairs them with .mjs)
// while their relative imports are extensionless CJS style with dotted
// filenames ('./PrimeReact.context'); resolution fails and `export *`
// silently drops PrimeReactProvider from the module's type surface. The
// runtime export is fine. This augmentation restores the one symbol the app
// uses, typed to the surface Qualy actually passes.
// Removal condition: upstream declaration files resolve under NodeNext
// (extensioned relative imports or .d.mts), verified by deleting this file
// and running pnpm typecheck.
declare module '@primereact/core/config' {
  export function PrimeReactProvider(inProps?: {
    children?: ReactNode
    theme?: { preset?: unknown; options?: unknown }
    license?: string | undefined
  }): ReactNode
}
