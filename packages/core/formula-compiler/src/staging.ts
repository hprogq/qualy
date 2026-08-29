/**
 * The isolated TS7 workspace a formula is checked in (subpath on purpose:
 * node-only — fs, child_process — while the SDK root stays runnable inside
 * an artifact). Publication and the SDK's own gate tests share this file so
 * they can never drift apart.
 *
 * Two fences around the compiler, because tsc RESOLVES whatever the source
 * names even though it executes nothing — an unchecked specifier is a read
 * of the host filesystem and a type-information oracle:
 *
 * 1. `sourcePolicy` (source-policy.ts: a real TS6 AST, parsed in memory
 *    with nothing resolvable) refuses every syntax that can trigger module
 *    resolution before the compiler is ever spawned.
 * 2. The staged workspace itself resolves almost nothing: `@qualy/formula`
 *    is a SYNTHETIC package exporting only ".", its `@qualy/value-schema`
 *    dependency nests INSIDE it, and the workspace root holds nothing else —
 *    so `./runtime`, `./staging` and the value-schema package are not even
 *    resolvable from a formula, whatever slips past the policy.
 *
 * The workspace lives under the OS temp root, never inside the repository,
 * so nothing resolves by walking up into a monorepo, and the compiler
 * surface is fixed here with no `plugins` entry: the Effect language service
 * has no business inside a formula even though the workspace tsc binary
 * itself is effect-patched.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const here = createRequire(import.meta.url)

/** the sdk package's root, and its one dependency's, resolved as installed */
export const formulaPackageRoot = path.dirname(here.resolve('@qualy/formula/package.json'))
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

/** the one manifest a formula may resolve: the SDK's public face, "." only */
const SYNTHETIC_MANIFEST = JSON.stringify(
  {
    name: '@qualy/formula',
    version: '0.0.0',
    type: 'module',
    exports: { '.': './src/index.ts' },
  },
  null,
  2,
)

export const stageFormulaWorkspace = (source: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-formula-'))
  const sdk = path.join(root, 'node_modules', '@qualy', 'formula')
  fs.mkdirSync(sdk, { recursive: true })
  fs.writeFileSync(path.join(sdk, 'package.json'), SYNTHETIC_MANIFEST)
  fs.symlinkSync(path.join(formulaPackageRoot, 'src'), path.join(sdk, 'src'))
  const nested = path.join(sdk, 'node_modules', '@qualy')
  fs.mkdirSync(nested, { recursive: true })
  fs.symlinkSync(valueSchemaPackageRoot, path.join(nested, 'value-schema'))
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
  /** the compiler was killed at the wall clock, not finished */
  readonly timedOut: boolean
}

/**
 * Run a TypeScript entry (the module behind `tsc`, executed with the current
 * node) over a staged workspace. Argv array only — no shell ever sees a
 * formula's text — a wall-clock timeout because a compiler is still a
 * program someone else feeds, and a bounded output buffer because so are
 * its diagnostics.
 */
export const checkFormulaWorkspace = (
  root: string,
  tscEntry: string,
  timeoutMs = 15_000,
): Promise<CheckOutcome> =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [tscEntry, '-p', root, '--pretty', 'false'],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const killed = error !== null && 'killed' in error && error.killed === true
        if (error && !killed && typeof error.code !== 'number') return reject(error)
        resolve({
          code: killed ? 1 : typeof error?.code === 'number' ? error.code : 0,
          output: `${stdout}${stderr}`,
          timedOut: killed,
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

export interface ParsedDiagnostics {
  readonly diagnostics: readonly FormulaDiagnostic[]
  /** rows or message bytes were dropped to stay within the budget */
  readonly truncated: boolean
}

const DIAGNOSTIC_HEAD = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const BARE_DIAGNOSTIC = /^error (TS\d+): (.*)$/

const MAX_DIAGNOSTICS = 50
const MAX_MESSAGE_LENGTH = 2000

/**
 * Structured diagnostics from `--pretty false` output. Diagnostics are
 * BLOCKS, not lines: continuation lines belong to the message above them,
 * and a file-less compiler error still deserves a row (line 0). Rows and
 * message sizes are budgeted, and the budget's application is reported.
 */
export const parseDiagnostics = (output: string): ParsedDiagnostics => {
  const diagnostics: FormulaDiagnostic[] = []
  let truncated = false
  let current: { line: number; column: number; code: string; parts: string[] } | undefined
  const flush = () => {
    if (current === undefined) return
    if (diagnostics.length >= MAX_DIAGNOSTICS) {
      truncated = true
    } else {
      const message = current.parts.join('\n')
      if (message.length > MAX_MESSAGE_LENGTH) truncated = true
      diagnostics.push({
        line: current.line,
        column: current.column,
        code: current.code,
        message: message.slice(0, MAX_MESSAGE_LENGTH),
      })
    }
    current = undefined
  }
  for (const line of output.split('\n')) {
    const positioned = DIAGNOSTIC_HEAD.exec(line)
    if (positioned !== null) {
      flush()
      current = {
        line: Number(positioned[2]),
        column: Number(positioned[3]),
        code: positioned[4]!,
        parts: [positioned[5]!],
      }
      continue
    }
    const bare = BARE_DIAGNOSTIC.exec(line)
    if (bare !== null) {
      flush()
      current = { line: 0, column: 0, code: bare[1]!, parts: [bare[2]!] }
      continue
    }
    if (current !== undefined && line !== '') current.parts.push(line)
  }
  flush()
  return { diagnostics, truncated }
}
