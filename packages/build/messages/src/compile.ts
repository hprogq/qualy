// eslint-disable-next-line typescript/triple-slash-reference -- the ICU plugin ships no types, and every program that reaches this file needs the declaration beside it
/// <reference path="./inlang-plugin-icu1.d.ts" />
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, type Token } from '@messageformat/parser'
import { compileProject } from '@inlang/paraglide-js'
import icu1 from '@inlang/plugin-icu1'
import { loadProjectFromDirectory, type InlangPlugin } from '@inlang/sdk'
import { productRootFor, readManifest } from '@qualy/assembly'
import { resolvePackageDir } from '@qualy/assembly/host'
import { supportedLocales } from '@qualy/i18n-contract'
import { namespaceOf } from '@qualy/i18n-contract/namespace'
import { manifestPath as defaultManifestPath, repoRoot } from './manifest.ts'

// The message compiler (docs/adr/0011-i18n-paraglide.md).
//
// Every package that says things ships them as data: `messages/<locale>.json`
// beside its package.json, ICU MessageFormat 1, keyed by local names. This
// merges all of them - each key under its package's namespace - into one
// inlang project nobody edits, compiles it once with Paraglide, and gives each
// package a facade over its own part: what `#messages` resolves to from inside
// that package, and from nowhere else. One compilation, one runtime, one set
// of message functions the bundler places next to the code that calls them.
//
// Three things are Qualy's own on top of Paraglide:
//
// - The import is normalized before compiling. The ICU plugin hands `#` over
//   as a function Paraglide does not know, which would print the bare number
//   where every other ICU implementation formats it; and it compares a
//   `=0`-style case against the string "0", which a number never equals.
//   Both are rewritten to the number formatter, which is what ICU means.
// - The locale runtime. A page has one language from the moment it opens,
//   marked on its root; a message on a page reads that, and a message
//   anywhere else must be given its locale or it throws. Paraglide's own
//   runtime - strategies, cookies, redirects - is replaced by those few
//   lines, and the compiler's imports from it are checked on every build.
// - The facade's types. Paraglide types an input it cannot pin as
//   `NonNullable<unknown>`; the facade says what ICU itself says: a plural,
//   ordinal or number operand is a number, a date or time is a Date, a select
//   is a string, and a plain placeholder takes a string or a number.

export type OutputStructure = 'message-modules' | 'locale-modules'

export interface MessageSource {
  /** under which the package's keys are merged: its name, made into one */
  readonly namespace: string
  /** the package whose `messages/` these are, and whose code may import them */
  readonly packageRoot: string
  /** the package's name */
  readonly owner: string
}

/** where the compiled messages and the generated facades live, under the product */
export const messagesOutDir = (productRoot: string) => path.join(productRoot, '.qualy', 'i18n')

/** the platform's own sentences, compiled beside every plugin's */
const PLATFORM_PACKAGES = ['packages/web/i18n']

const KEY = /^[a-z][a-zA-Z0-9]*(?:_[a-z][a-zA-Z0-9]*)*$/

/**
 * The namespace a package's keys are merged under, from its name. A package
 * never writes it: its code imports `#messages` and names only its own keys,
 * so nothing has to agree with anything, and two packages cannot collide
 * because two packages cannot share a name.
 */
export { namespaceOf } from '@qualy/i18n-contract/namespace'

/** a package that ships `messages/`, as a source */
export const messageSourceAt = (packageRoot: string): MessageSource => {
  const { name } = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    name: string
  }
  return { namespace: namespaceOf(name), packageRoot, owner: name }
}

const shipsMessages = (packageRoot: string) => fs.existsSync(path.join(packageRoot, 'messages'))

/**
 * Release messages follow the active manifest selection. Repository checks
 * explicitly request installed packages too, so disabled sources still typecheck.
 * Discover JSON inputs without executing plugin descriptors.
 */
export async function messageSources(
  manifest = defaultManifestPath(),
  all = false,
): Promise<MessageSource[]> {
  const productRoot = productRootFor(manifest)
  const product = JSON.parse(fs.readFileSync(path.join(productRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const found: MessageSource[] = []
  const active = readManifest(manifest).plugins
  const names = all
    ? Object.keys(product.dependencies ?? {})
    : [...active].filter(([, entry]) => entry.enabled).map(([name]) => name)
  for (const name of names.sort()) {
    let packageRoot: string
    try {
      packageRoot = resolvePackageDir(name, manifest)
    } catch (cause) {
      throw new Error(`cannot find message source package ${name}`, { cause })
    }
    if (shipsMessages(packageRoot)) found.push(messageSourceAt(packageRoot))
  }
  for (const platform of PLATFORM_PACKAGES)
    found.push(messageSourceAt(path.join(repoRoot, platform)))
  return found
}

type Kind = 'number' | 'date' | 'select' | 'plain'

const mergeKind = (left: Kind, right: Kind, where: string): Kind => {
  if (left === right || right === 'plain') return left
  if (left === 'plain') return right
  throw new Error(`${where} has incompatible input kinds: ${left} and ${right}`)
}

/** what each argument of one ICU message is, as the grammar itself says */
const argumentsOf = (source: string, where: string): Map<string, Kind> => {
  let tokens: Token[]
  try {
    tokens = parse(source, { strict: false })
  } catch (error) {
    throw new Error(`${where} is not ICU MessageFormat: ${JSON.stringify(source)}`, {
      cause: error,
    })
  }
  const found = new Map<string, Kind>()
  const note = (name: string, kind: Kind) => {
    const known = found.get(name)
    found.set(name, known === undefined ? kind : mergeKind(known, kind, `${where} ${name}`))
  }
  const walk = (list: readonly Token[]) => {
    for (const token of list) {
      if (token.type === 'argument') note(token.arg, 'plain')
      else if (token.type === 'function') {
        const key = token.key.toLowerCase()
        note(
          token.arg,
          key === 'date' || key === 'time' ? 'date' : key === 'number' ? 'number' : 'plain',
        )
        if (key !== 'number' && key !== 'date' && key !== 'time') {
          throw new Error(
            `${where} uses {${token.arg}, ${token.key}}, which the compiler cannot format`,
          )
        }
      } else if (
        token.type === 'select' ||
        token.type === 'plural' ||
        token.type === 'selectordinal'
      ) {
        if (token.pluralOffset !== undefined && token.pluralOffset !== 0) {
          throw new Error(`${where} uses a plural offset, which the compiler cannot format`)
        }
        note(token.arg, token.type === 'select' ? 'select' : 'number')
        for (const branch of token.cases) {
          if (/^=\d+$/.test(branch.key) && Number(branch.key.slice(1)) >= 1000) {
            throw new Error(
              `${where} matches ${branch.key}, which the number formatter would group`,
            )
          }
          walk(branch.tokens)
        }
      }
    }
  }
  walk(tokens)
  return found
}

interface Compiled {
  readonly namespace: string
  readonly key: string
  readonly english: string
  readonly inputs: Map<string, Kind>
}

/** reads and checks every source: same keys in every locale, same arguments, sound ICU */
export function readMessages(sources: readonly MessageSource[]): {
  byLocale: Record<string, Record<string, string>>
  compiled: Compiled[]
} {
  const problems: string[] = []
  const namespaces = new Map<string, string>()
  const byLocale: Record<string, Record<string, string>> = {}
  for (const locale of supportedLocales) byLocale[locale] = {}
  const compiled: Compiled[] = []
  for (const source of sources) {
    const claimed = namespaces.get(source.namespace)
    if (claimed !== undefined)
      problems.push(`namespace ${source.namespace} claimed by ${claimed} and ${source.owner}`)
    namespaces.set(source.namespace, source.owner)
    const tables: Record<string, Record<string, string>> = {}
    for (const locale of supportedLocales) {
      const file = path.join(source.packageRoot, 'messages', `${locale}.json`)
      if (!fs.existsSync(file)) {
        problems.push(`${source.owner} ships no ${path.relative(repoRoot, file)}`)
        tables[locale] = {}
        continue
      }
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        problems.push(`${source.owner} ${locale} must be a JSON object of strings`)
        tables[locale] = {}
        continue
      }
      const table: Record<string, string> = {}
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== 'string')
          problems.push(`${source.namespace}.${key} (${locale}) must be a string`)
        else table[key] = value
      }
      tables[locale] = table
    }
    const keys = Object.keys(tables['en-US'] ?? {})
    for (const locale of supportedLocales) {
      const own = Object.keys(tables[locale]!)
      const missing = keys.filter((key) => !Object.hasOwn(tables[locale]!, key))
      const orphans = own.filter((key) => !keys.includes(key))
      if (missing.length > 0)
        problems.push(`${source.namespace} ${locale} lacks ${missing.join(', ')}`)
      if (orphans.length > 0)
        problems.push(`${source.namespace} ${locale} has ${orphans.join(', ')} that en-US does not`)
    }
    for (const key of keys) {
      if (!KEY.test(key)) {
        problems.push(`${source.namespace}.${key} is not a message key`)
        continue
      }
      const perLocale = new Map<string, Map<string, Kind>>()
      for (const locale of supportedLocales) {
        const text = tables[locale]![key]
        if (typeof text !== 'string') continue
        try {
          perLocale.set(locale, argumentsOf(text, `${source.namespace}.${key} (${locale})`))
        } catch (error) {
          problems.push((error as Error).message)
          continue
        }
        byLocale[locale]![`${source.namespace}.${key}`] = text
      }
      // a translation decides its own sentence, not its own arguments
      const english = perLocale.get('en-US')
      if (english === undefined) continue
      const inputs = new Map(english)
      for (const [locale, found] of perLocale) {
        const invented = [...found.keys()].filter((name) => !english.has(name))
        const dropped = [...english.keys()].filter((name) => !found.has(name))
        if (invented.length > 0 || dropped.length > 0) {
          problems.push(
            `${source.namespace}.${key} (${locale}) ${[
              invented.length > 0 ? `reads ${invented.join(', ')} that en-US does not pass` : '',
              dropped.length > 0 ? `drops ${dropped.join(', ')}` : '',
            ]
              .filter(Boolean)
              .join(' and ')}`,
          )
        }
        for (const [name, kind] of found) {
          const known = inputs.get(name)
          if (known !== undefined) {
            try {
              inputs.set(
                name,
                mergeKind(known, kind, `${source.namespace}.${key} (${locale}) ${name}`),
              )
            } catch (error) {
              problems.push((error as Error).message)
            }
          }
        }
      }
      compiled.push({ namespace: source.namespace, key, english: tables['en-US']![key]!, inputs })
    }
  }
  if (problems.length > 0) {
    throw new Error(`the messages do not compile:\n  ${problems.join('\n  ')}`)
  }
  return { byLocale, compiled }
}

/** the ICU plugin, its import brought to what ICU means (see the head of this file) */
const normalizedIcu: InlangPlugin = {
  ...icu1,
  importFiles: (args) => {
    if (icu1.importFiles === undefined) throw new Error('the ICU plugin imports no files')
    const imported = icu1.importFiles(args)
    const { bundles, variants } = imported as unknown as {
      bundles: {
        declarations: { type: string; value?: { annotation?: unknown; arg?: { type: string } } }[]
      }[]
      variants: { pattern: { type: string; annotation?: { name: string; options: unknown[] } }[] }[]
    }
    for (const bundle of bundles) {
      for (const declaration of bundle.declarations) {
        // the one unannotated local the plugin makes: an exact-case selector
        if (
          declaration.type === 'local-variable' &&
          declaration.value !== undefined &&
          declaration.value.annotation === undefined &&
          declaration.value.arg?.type === 'variable-reference'
        ) {
          declaration.value.annotation = { type: 'function-reference', name: 'number', options: [] }
        }
      }
    }
    for (const variant of variants) {
      for (const part of variant.pattern) {
        if (part.type === 'expression' && part.annotation?.name === 'icu:pound') {
          part.annotation = { ...part.annotation, name: 'number', options: [] }
        }
      }
    }
    return imported
  },
}

/** the runtime a compiled message imports: the page's locale, or none */
const RUNTIME = `// generated by the message compiler; do not edit
// A message on a page is in the page's language, marked on its root before
// anything rendered; anywhere else it must be given { locale } or it throws.
export const baseLocale = 'en-US'
export const locales = /** @type {const} */ (${JSON.stringify(supportedLocales)})
export const experimentalStaticLocale = undefined
export const getLocale = () => {
  const locale = globalThis.document?.documentElement?.dataset?.locale
  if (locales.includes(locale)) return locale
  throw new Error('a message was formatted with no locale: outside a page, pass { locale }')
}
`

const RUNTIME_EXPORTS = new Set(['getLocale', 'experimentalStaticLocale', 'baseLocale', 'locales'])

const tsType = (kind: Kind) =>
  kind === 'date'
    ? 'Date'
    : kind === 'number'
      ? 'number'
      : kind === 'select'
        ? 'string'
        : 'string | number'

const docOf = (text: string) => text.replaceAll('*/', '*\\/').replaceAll('\n', ' ')

const facadeSource = (namespace: string, messages: readonly Compiled[], from: string) => {
  const lines = messages.map(
    (message) => `  ${JSON.stringify(`${namespace}.${message.key}`)} as ${message.key},`,
  )
  return `// generated by the message compiler from messages/*.json; do not edit\nexport {\n${lines.join('\n')}\n} from ${JSON.stringify(from)}\n`
}

const declarationSource = (messages: readonly Compiled[]) => {
  const lines = [
    '// generated by the message compiler from messages/*.json; do not edit',
    `type Locale = ${supportedLocales.map((locale) => JSON.stringify(locale)).join(' | ')}`,
    'interface Options {',
    "  /** required anywhere that is not a page, where the page's own is taken */",
    '  readonly locale?: Locale',
    '}',
  ]
  for (const message of messages) {
    const inputs = [...message.inputs].map(
      ([name, kind]) => `${JSON.stringify(name)}: ${tsType(kind)}`,
    )
    const parameter =
      inputs.length === 0 ? 'inputs?: Record<string, never>' : `inputs: { ${inputs.join('; ')} }`
    lines.push(`/** ${docOf(message.english)} */`)
    lines.push(`export declare const ${message.key}: (${parameter}, options?: Options) => string`)
  }
  return `${lines.join('\n')}\n`
}

const relativeImport = (fromDir: string, file: string) => {
  const relative = path.relative(fromDir, file).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

/**
 * Writes a file only when its content changed, so a watcher sees only real
 * changes, and whole: the dev server and a backend in development compile the
 * same inputs side by side, and neither may read the other's half-written file.
 */
const put = (file: string, content: string, written: Set<string>) => {
  written.add(path.resolve(file))
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const partial = `${file}.${process.pid}.partial`
  fs.writeFileSync(partial, content)
  fs.renameSync(partial, file)
}

/** a file this compile did not write goes, but not one a compile beside it is writing */
const drop = (file: string, written: Set<string>) => {
  if (written.has(file) || file.endsWith('.partial')) return
  fs.rmSync(file, { force: true })
}

export interface CompileOptions {
  readonly manifestPath?: string
  /**
   * The dev server asks for one module per locale, a build for one per
   * message; a gate that only reads the facades asks for neither and keeps
   * whichever is there, so it never rewrites what a running server serves.
   */
  readonly outputStructure?: OutputStructure
  /** the sources, when the caller already knows them (a test, a watcher) */
  readonly sources?: readonly MessageSource[]
  /** compiles even when nothing it reads has changed */
  readonly force?: boolean
  /** Repository checks include installed packages; releases compile the active selection only. */
  readonly all?: boolean
}

export interface CompileResult {
  readonly outDir: string
  readonly sources: readonly MessageSource[]
  readonly messages: number
  /** false when the inputs were unchanged and nothing was written */
  readonly compiled: boolean
}

/**
 * Compiles every package's messages into `<product>/.qualy/i18n`, and writes
 * each workspace package's `#messages` facade into its own `.qualy/`.
 */
export async function compileMessages(options: CompileOptions): Promise<CompileResult> {
  const manifest = options.manifestPath ?? defaultManifestPath()
  const productRoot = productRootFor(manifest)
  const outDir = messagesOutDir(productRoot)
  const sources = options.sources ?? (await messageSources(manifest, options.all))

  const stampFile = path.join(outDir, 'stamp.json')
  const stamp = fs.existsSync(stampFile)
    ? (JSON.parse(fs.readFileSync(stampFile, 'utf8')) as {
        fingerprint?: string
        structure?: OutputStructure
        messages?: number
        outputs?: { file: string; size: number }[]
      })
    : {}
  const structure = options.outputStructure ?? stamp.structure ?? 'message-modules'
  const hash = createHash('sha256').update(structure)
  // Raw inputs first: the unchanged path never parses ICU or builds the merged project.
  for (const source of sources) {
    hash.update(JSON.stringify([source.namespace, source.packageRoot]))
    for (const locale of supportedLocales) {
      const file = path.join(source.packageRoot, 'messages', `${locale}.json`)
      if (!fs.existsSync(file)) readMessages(sources) // report the owner and missing language
      hash.update(fs.readFileSync(file))
    }
  }
  for (const file of [...walkFiles(path.dirname(fileURLToPath(import.meta.url)))].sort())
    hash.update(fs.readFileSync(file))
  for (const name of [
    '@inlang/paraglide-js',
    '@inlang/plugin-icu1',
    '@inlang/sdk',
    '@messageformat/parser',
  ]) {
    let directory = path.dirname(createRequire(import.meta.url).resolve(name))
    while (!fs.existsSync(path.join(directory, 'package.json'))) directory = path.dirname(directory)
    hash.update(fs.readFileSync(path.join(directory, 'package.json')))
  }
  hash.update(JSON.stringify(supportedLocales))
  const fingerprint = hash.digest('hex')
  const outputsPresent =
    stamp.outputs !== undefined &&
    stamp.outputs.length > 0 &&
    stamp.outputs.every(({ file, size }) => {
      try {
        return fs.statSync(file).size === size
      } catch {
        return false
      }
    })
  if (
    !options.force &&
    stamp.fingerprint === fingerprint &&
    outputsPresent &&
    stamp.messages !== undefined
  ) {
    return { outDir, sources, messages: stamp.messages, compiled: false }
  }
  const { byLocale, compiled } = readMessages(sources)

  // the project the compiler reads: merged, never edited, never written back,
  // and this process's own, so a compile beside it cannot pull it away
  const projectDir = path.join(outDir, 'project', String(process.pid))
  fs.rmSync(projectDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(projectDir, 'project.inlang'), { recursive: true })
  fs.mkdirSync(path.join(projectDir, 'messages'), { recursive: true })
  fs.writeFileSync(
    path.join(projectDir, 'project.inlang', 'settings.json'),
    `${JSON.stringify(
      {
        baseLocale: 'en-US',
        locales: supportedLocales,
        // provided in-process from the pinned package; nothing is fetched
        modules: [],
        'plugin.inlang.icu-messageformat-1': { pathPattern: './messages/{locale}.json' },
      },
      null,
      2,
    )}\n`,
  )
  for (const locale of supportedLocales) {
    fs.writeFileSync(
      path.join(projectDir, 'messages', `${locale}.json`),
      `${JSON.stringify(byLocale[locale], null, 1)}\n`,
    )
  }
  const project = await loadProjectFromDirectory({
    path: path.join(projectDir, 'project.inlang'),
    fs,
    providePlugins: [normalizedIcu],
  })
  try {
    const errors = await project.errors.get()
    if (errors.length > 0) throw new AggregateError(errors, 'the message project does not load')
    // one output for the browser, in the layout the caller asked for, and
    // one module per locale for Node: a server loads every message at once,
    // and thousands of modules would cost it its start
    const compileAs = async (outputStructure: OutputStructure) => {
      const output = await compileProject({
        project,
        compilerOptions: {
          outputStructure,
          strategy: ['custom-qualy'],
          emitGitIgnore: false,
          emitPrettierIgnore: false,
          emitReadme: false,
          includeEslintDisableComment: false,
        },
      })
      delete output['server.js']
      output['runtime.js'] = RUNTIME
      output['package.json'] =
        `${JSON.stringify({ type: 'module', sideEffects: false }, null, 2)}\n`
      // the compiled messages may import nothing from the runtime but what it has
      for (const [file, text] of Object.entries(output)) {
        for (const match of text.matchAll(
          /import\s*\{([^}]*)\}\s*from\s*["'](?:\.\.\/|\.\/)runtime\.js["']/g,
        )) {
          for (const name of match[1]!
            .split(',')
            .map((one) => one.trim())
            .filter(Boolean)) {
            if (!RUNTIME_EXPORTS.has(name)) {
              throw new Error(
                `${file} imports ${name} from the runtime, which the message compiler does not provide`,
              )
            }
          }
        }
      }
      return output
    }
    const output = await compileAs(structure)
    const serverOutput = structure === 'locale-modules' ? output : await compileAs('locale-modules')
    const written = new Set<string>()
    const compiledDir = path.join(outDir, 'paraglide')
    for (const [file, text] of Object.entries(output))
      put(path.join(compiledDir, file), text, written)
    for (const stale of walkFiles(compiledDir)) drop(stale, written)
    const serverDir = path.join(outDir, 'server')
    for (const [file, text] of Object.entries(serverOutput)) {
      put(path.join(serverDir, file), text, written)
    }
    for (const stale of walkFiles(serverDir)) drop(stale, written)
    put(
      path.join(outDir, 'package.json'),
      `${JSON.stringify({ type: 'module', sideEffects: false }, null, 2)}\n`,
      written,
    )

    const index = path.join(compiledDir, 'messages', '_index.js')
    for (const source of sources) {
      const own = compiled.filter((message) => message.namespace === source.namespace)
      // a published package is not written into: the build resolves its
      // #messages to a facade kept here instead
      put(
        path.join(outDir, 'facades', `${source.namespace}.js`),
        facadeSource(source.namespace, own, relativeImport(path.join(outDir, 'facades'), index)),
        written,
      )
      put(path.join(outDir, 'facades', `${source.namespace}.d.ts`), declarationSource(own), written)
      if (!keepsLocalFacade(source.packageRoot, productRoot)) continue
      const facadeDir = path.join(source.packageRoot, '.qualy')
      put(
        path.join(facadeDir, 'messages.js'),
        facadeSource(source.namespace, own, relativeImport(facadeDir, index)),
        written,
      )
      put(path.join(facadeDir, 'messages.d.ts'), declarationSource(own), written)
    }
    // a facade for a package no longer compiled goes with it
    for (const stale of walkFiles(path.join(outDir, 'facades'))) drop(stale, written)
    const outputs = [...written].sort().map((file) => ({ file, size: fs.statSync(file).size }))
    put(
      stampFile,
      `${JSON.stringify({ fingerprint, structure, messages: compiled.length, outputs }, null, 2)}\n`,
      written,
    )
  } finally {
    await project.close()
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
  return { outDir, sources, messages: compiled.length, compiled: true }
}

function* walkFiles(directory: string): Generator<string> {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.resolve(directory, entry.name)
    if (entry.isDirectory()) yield* walkFiles(file)
    else yield file
  }
}

/**
 * Whether a package keeps its #messages facade in its own tree, which is
 * what its import map says. A workspace package does, so Node and the type
 * checker find it; a published one does not - nothing is written into an
 * installed package - and the build resolves its #messages instead.
 */
const keepsLocalFacade = (packageRoot: string, productRoot: string): boolean => {
  // only the product's own packages point at the product's compilation: a
  // build of another product (a test's) must not rewrite theirs
  const real = (at: string) => fs.realpathSync(at)
  if (!`${real(packageRoot)}${path.sep}`.startsWith(`${real(productRoot)}${path.sep}`)) return false
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    imports?: Record<string, unknown>
  }
  const target = manifest.imports?.['#messages']
  return JSON.stringify(target ?? null).includes('./.qualy/messages')
}

/** the facade `#messages` names for a package of the product, published or not */
export const facadeFor = (productRoot: string, namespace: string): string =>
  path.join(messagesOutDir(productRoot), 'facades', `${namespace}.js`)
