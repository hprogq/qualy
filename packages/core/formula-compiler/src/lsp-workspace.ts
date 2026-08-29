/**
 * The per-session workspace a formula LSP runs against. COPIED, never
 * symlinked: the compile staging may point at the installed packages
 * because tsc reads them once and dies, but a language server is a
 * long-lived interactive filesystem oracle, and its whole visible world
 * must be this directory - formula.ts, the frozen tsconfig, and the
 * author-facing SDK sources. Nothing else exists to walk to.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FORMULA_TSCONFIG, formulaPackageRoot, valueSchemaPackageRoot } from './staging.ts'

/** the sdk manifest, public face "." only - same shape staging uses */
const SDK_MANIFEST = JSON.stringify(
  {
    name: '@qualy/formula',
    version: '0.0.0',
    type: 'module',
    exports: { '.': './src/index.ts' },
  },
  null,
  2,
)

export interface LspWorkspace {
  readonly root: string
  readonly formulaPath: string
  /** the sdk root inside the workspace, for URI mapping */
  readonly sdkRoot: string
}

export const makeLspWorkspace = (initialSource: string): LspWorkspace => {
  // realpath at birth: macOS tmp lives behind a /var -> /private/var
  // symlink, and the language server answers in REAL paths - the URI
  // boundary must speak the same spelling or drop everything it says
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-lsp-')))
  const sdk = path.join(root, 'node_modules', '@qualy', 'formula')
  fs.mkdirSync(sdk, { recursive: true })
  fs.writeFileSync(path.join(sdk, 'package.json'), SDK_MANIFEST)
  fs.cpSync(path.join(formulaPackageRoot, 'src'), path.join(sdk, 'src'), { recursive: true })
  const nested = path.join(sdk, 'node_modules', '@qualy', 'value-schema')
  fs.mkdirSync(nested, { recursive: true })
  fs.copyFileSync(
    path.join(valueSchemaPackageRoot, 'package.json'),
    path.join(nested, 'package.json'),
  )
  fs.cpSync(path.join(valueSchemaPackageRoot, 'src'), path.join(nested, 'src'), {
    recursive: true,
  })
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(FORMULA_TSCONFIG, null, 2))
  const formulaPath = path.join(root, 'formula.ts')
  fs.writeFileSync(formulaPath, initialSource)
  return { root, formulaPath, sdkRoot: path.join(root, 'node_modules', '@qualy') }
}

export const dropLspWorkspace = (workspace: LspWorkspace): void => {
  fs.rmSync(workspace.root, { recursive: true, force: true })
}
