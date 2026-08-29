// The staging itself moved into the SDK (@qualy/formula/staging) so that
// publication and these gate tests run the identical workspace; what stays
// here is only the test-side resolution of the compiler entry.
import path from 'node:path'
import { createRequire } from 'node:module'

export {
  checkFormulaWorkspace,
  dropWorkspace,
  parseDiagnostics,
  stageFormulaWorkspace,
} from '@qualy/formula/staging'

// typescript's exports map hides bin/ and package.json; the one resolvable
// entry is the version module, and the bin sits two hops from it
export const tscEntry = path.join(
  path.dirname(createRequire(import.meta.url).resolve('typescript')),
  '..',
  'bin',
  'tsc',
)
