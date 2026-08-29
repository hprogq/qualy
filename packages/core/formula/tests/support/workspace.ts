import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

// The staging that publication will reuse: an isolated workspace under the
// OS temp root (never inside the repository tree, so nothing resolves by
// walking up into the monorepo), with the SDK and its one dependency laid
// out explicitly. A formula sees exactly two packages, or it does not
// compile.

const repoRoot = path.resolve(import.meta.dirname, '../../../../..')

export const tscBinary = path.join(repoRoot, 'node_modules', '.bin', 'tsc')

// the fixed compiler surface a formula is checked against; no `plugins`
// entry on purpose — the Effect language service has no business inside a
// formula even though the workspace tsc binary itself is effect-patched
const FORMULA_TSCONFIG = {
  compilerOptions: {
    target: 'ES2020',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    useUnknownInCatchVariables: true,
    isolatedModules: true,
    verbatimModuleSyntax: true,
    allowImportingTsExtensions: true,
    lib: ['ES2020'],
    types: [],
    noEmit: true,
  },
  files: ['formula.ts'],
}

export const stageFormulaWorkspace = (source: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-formula-'))
  const scoped = path.join(root, 'node_modules', '@qualy')
  fs.mkdirSync(scoped, { recursive: true })
  fs.symlinkSync(path.join(repoRoot, 'packages/core/formula'), path.join(scoped, 'formula'))
  fs.symlinkSync(
    path.join(repoRoot, 'packages/core/value-schema'),
    path.join(scoped, 'value-schema'),
  )
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(FORMULA_TSCONFIG, null, 2))
  fs.writeFileSync(path.join(root, 'formula.ts'), source)
  return root
}

export interface CheckOutcome {
  readonly code: number
  readonly output: string
}

/** run the workspace tsc over a staged formula workspace; argv only, no shell */
export const checkFormula = (root: string): Promise<CheckOutcome> =>
  new Promise((resolve, reject) => {
    execFile(
      tscBinary,
      ['-p', root, '--pretty', 'false'],
      { timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error)
        resolve({
          code: typeof error?.code === 'number' ? error.code : 0,
          output: `${stdout}${stderr}`,
        })
      },
    )
  })

export const dropWorkspace = (root: string): void => {
  fs.rmSync(root, { recursive: true, force: true })
}
