/**
 * The isolated TS7 workspace a formula is checked in (subpath on purpose:
 * node-only — fs, child_process — while the SDK root stays runnable inside
 * an artifact). Publication and the SDK's own gate tests share this file so
 * they can never drift apart.
 *
 * The workspace lives under the OS temp root, never inside the repository,
 * so nothing resolves by walking up into a monorepo; exactly two packages
 * are staged — the SDK and its one dependency — and the compiler surface is
 * fixed here, with no `plugins` entry: the Effect language service has no
 * business inside a formula even though the workspace tsc binary itself is
 * effect-patched.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = createRequire(import.meta.url)

/** this package's root, and its one dependency's, resolved from here */
export const formulaPackageRoot = fileURLToPath(new URL('..', import.meta.url))
export const valueSchemaPackageRoot = path.dirname(here.resolve('@qualy/value-schema/package.json'))

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

/** why a source is refused before the compiler even runs */
export const TRIPLE_SLASH = /^\s*\/\/\/\s*<reference\b/m

export const stageFormulaWorkspace = (source: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-formula-'))
  const scoped = path.join(root, 'node_modules', '@qualy')
  fs.mkdirSync(scoped, { recursive: true })
  fs.symlinkSync(formulaPackageRoot, path.join(scoped, 'formula'))
  fs.symlinkSync(valueSchemaPackageRoot, path.join(scoped, 'value-schema'))
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(FORMULA_TSCONFIG, null, 2))
  fs.writeFileSync(path.join(root, 'formula.ts'), source)
  return root
}

export const dropWorkspace = (root: string): void => {
  fs.rmSync(root, { recursive: true, force: true })
}

export interface CheckOutcome {
  readonly code: number
  readonly output: string
}

/**
 * Run a TypeScript entry (the module behind `tsc`, executed with the current
 * node) over a staged workspace. Argv array only — no shell ever sees a
 * formula's text — and a wall-clock timeout because a compiler is still a
 * program someone else feeds.
 */
export const checkFormulaWorkspace = (
  root: string,
  tscEntry: string,
  timeoutMs = 60_000,
): Promise<CheckOutcome> =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [tscEntry, '-p', root, '--pretty', 'false'],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error)
        resolve({
          code: typeof error?.code === 'number' ? error.code : 0,
          output: `${stdout}${stderr}`,
        })
      },
    )
  })

export interface FormulaDiagnostic {
  readonly line: number
  readonly column: number
  readonly code: string
  readonly message: string
}

const DIAGNOSTIC = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

/** structured diagnostics from `--pretty false` output, formula.ts rows only */
export const parseDiagnostics = (output: string): readonly FormulaDiagnostic[] =>
  output
    .split('\n')
    .map((line) => DIAGNOSTIC.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      line: Number(match[2]),
      column: Number(match[3]),
      code: match[4]!,
      message: match[5]!,
    }))
