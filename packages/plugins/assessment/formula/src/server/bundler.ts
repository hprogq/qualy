/**
 * Compiles one formula source into a self-contained sandbox artifact.
 *
 * Everything the bundle sees lives in virtual namespaces — the entry wrapper
 * is generated here, the user source arrives as a string, and the SDK's own
 * files load under `qualy-sdk:<package>/<path>` names — so no real
 * filesystem path ever reaches the artifact and two builds of the same
 * source are byte-identical wherever they run. The user's module graph is a
 * closed set: `@qualy/formula` and nothing else; the SDK itself may pull
 * `@qualy/value-schema`, and any other specifier fails the build by name.
 *
 * The entrypoints are the wrapper's, never the author's: `__qualyContract`
 * hands the frozen schemas out, `__qualyInvoke` decodes, runs, encodes, and
 * turns a structured `q.fail` into an envelope the caller can tell apart
 * from a defect.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build, type Plugin as EsbuildPlugin } from 'esbuild'
import { formulaPackageRoot, valueSchemaPackageRoot } from '@qualy/formula/staging'

const packageRoots: Record<string, string> = {
  formula: formulaPackageRoot,
  'value-schema': valueSchemaPackageRoot,
}

const here = createRequire(import.meta.url)

const subpath = (packageName: string, exportName: string): string => {
  const root = packageRoots[packageName]!
  const manifest = here(path.join(root, 'package.json')) as {
    exports: Record<string, string>
  }
  const target = manifest.exports[exportName]
  if (typeof target !== 'string') throw new Error(`${packageName} does not export ${exportName}`)
  return path.posix.normalize(target.replace(/^\.\//, ''))
}

const WRAPPER = `import definition from 'qualy:formula'
import { decodeInput, encodeOutput, formulaContext, isFormulaFailure } from '@qualy/formula/runtime'

globalThis.__qualyContract = () => ({ input: definition.input, output: definition.output })

globalThis.__qualyInvoke = (inputJson) => {
  try {
    const decoded = decodeInput(definition.input, JSON.parse(inputJson))
    const value = definition.run(decoded, formulaContext)
    return JSON.stringify({ ok: true, amount: encodeOutput(definition.output, value) })
  } catch (error) {
    if (isFormulaFailure(error)) {
      return JSON.stringify({ ok: false, failure: { message: error.message } })
    }
    throw error
  }
}
`

export interface BundleFailure {
  readonly specifier: string
  readonly importer: string
}

export class FormulaBundleRefused extends Error {
  readonly refusals: readonly BundleFailure[]

  constructor(refusals: readonly BundleFailure[]) {
    super(`refused: ${refusals.map((refusal) => refusal.specifier).join(', ')}`)
    this.refusals = refusals
  }
}

export interface BundledFormula {
  readonly artifact: string
  /** every SDK file compiled in, virtual path → bytes, for the runtime hash */
  readonly sdkFiles: ReadonlyMap<string, string>
}

const sdkPath = (packageName: string, relative: string): string =>
  `${packageName}/${path.posix.normalize(relative)}`

export const bundleFormula = async (source: string): Promise<BundledFormula> => {
  const sdkFiles = new Map<string, string>()
  const refusals: BundleFailure[] = []

  const virtual: EsbuildPlugin = {
    name: 'qualy-virtual',
    setup(builder) {
      builder.onResolve({ filter: /^qualy:entry$/ }, () => ({
        path: 'entry',
        namespace: 'qualy-entry',
      }))
      builder.onResolve({ filter: /^qualy:formula$/ }, () => ({
        path: 'formula.ts',
        namespace: 'qualy-user',
      }))
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === 'qualy-entry' || args.namespace === 'qualy-user') {
          if (args.path === '@qualy/formula')
            return { path: sdkPath('formula', subpath('formula', '.')), namespace: 'qualy-sdk' }
          if (args.namespace === 'qualy-entry' && args.path === '@qualy/formula/runtime')
            return {
              path: sdkPath('formula', subpath('formula', './runtime')),
              namespace: 'qualy-sdk',
            }
          // the author's whole world is one import; name the trespass
          refusals.push({ specifier: args.path, importer: 'formula.ts' })
          return {
            path: args.path,
            namespace: 'qualy-refused',
            errors: [{ text: `a formula may only import '@qualy/formula', not '${args.path}'` }],
          }
        }
        if (args.namespace === 'qualy-sdk') {
          const [packageName] = args.path.includes('/') ? [args.path.split('/')[0]!] : [args.path]
          if (args.path.startsWith('./') || args.path.startsWith('../')) {
            const importerDir = path.posix.dirname(args.importer)
            const packageOf = args.importer.split('/')[0]!
            const resolved = path.posix.normalize(path.posix.join(importerDir, args.path))
            return { path: resolved, namespace: 'qualy-sdk', pluginData: packageOf }
          }
          if (args.path === '@qualy/value-schema')
            return {
              path: sdkPath('value-schema', subpath('value-schema', '.')),
              namespace: 'qualy-sdk',
            }
          refusals.push({ specifier: args.path, importer: args.importer })
          return {
            path: args.path,
            namespace: 'qualy-refused',
            errors: [
              { text: `the sdk graph is closed; '${packageName}' has no business in an artifact` },
            ],
          }
        }
        return undefined
      })

      builder.onLoad({ filter: /.*/, namespace: 'qualy-entry' }, () => ({
        contents: WRAPPER,
        loader: 'ts',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'qualy-user' }, () => ({
        contents: source,
        loader: 'ts',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'qualy-sdk' }, (args) => {
        const [packageName, ...rest] = args.path.split('/')
        const root = packageRoots[packageName!]
        if (root === undefined) return undefined
        const contents = fs.readFileSync(path.join(root, ...rest), 'utf8')
        sdkFiles.set(args.path, contents)
        return { contents, loader: 'ts' }
      })
    },
  }

  const outcome = await build({
    entryPoints: ['qualy:entry'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'neutral',
    target: 'es2020',
    treeShaking: true,
    minify: false,
    sourcemap: false,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
    plugins: [virtual],
  }).catch((failure: unknown) => {
    if (refusals.length > 0) throw new FormulaBundleRefused(refusals)
    throw failure
  })
  if (refusals.length > 0) throw new FormulaBundleRefused(refusals)
  const artifact = outcome.outputFiles?.[0]?.text
  if (artifact === undefined) throw new Error('esbuild produced no output')
  return { artifact, sdkFiles }
}
