import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Where generated artifacts live.
//
// Anchored at this file rather than at the working directory or at whatever
// manifest was passed, because every one of them is reached by a static
// import: the host imports runtime.gen.ts by relative path, so the generator
// cannot decide to put it elsewhere. `--yml` chooses which selection is
// generated, never where it lands.
const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

export const RUNTIME_MODULE = path.join(repoRoot, 'packages/app/runtime.gen.ts')
