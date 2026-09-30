import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { installMessageTable, type MessageRef, type MessageTable } from './index.ts'

// The half of the server's texts that needs Node: naming a package's messages
// from the module that declares them, and loading the compiled messages a
// product's build left beside it.

type InputsOf<Said> = Said extends (inputs: infer Inputs, ...rest: never[]) => string
  ? Exclude<Inputs, undefined>
  : never

/** the namespace the message compiler merged a package's keys under, from its name */
export const namespaceOf = (packageName: string): string =>
  packageName
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const namespaceOfModule = (moduleUrl: string): string => {
  for (let dir = path.dirname(fileURLToPath(moduleUrl)); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) {
      const { name } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: string }
      if (name === undefined) throw new Error(`${manifest} names no package`)
      return namespaceOf(name)
    }
    if (path.dirname(dir) === dir) throw new Error(`no package holds ${moduleUrl}`)
  }
}

/**
 * A package's messages as references, typed off its own facade:
 *
 * ```ts
 * import type * as M from '#messages'
 * const m = messageRefs<typeof M>(import.meta.url)
 * text(m.navigation_batches)
 * ```
 *
 * The import is a type: a declaration naming a message runs before any
 * message is compiled (resolution imports it), so it holds a name, and the
 * name is looked up when an answer is rendered. The namespace is the
 * package's own, found from the module that asks.
 */
export const messageRefs = <Facade>(
  moduleUrl: string,
): { readonly [Key in keyof Facade]: MessageRef<InputsOf<Facade[Key]>> } => {
  const namespace = namespaceOfModule(moduleUrl)
  return new Proxy({} as never, {
    get: (_target, key) =>
      typeof key === 'string' ? ({ namespace, key } satisfies MessageRef<unknown>) : undefined,
  })
}

type Say = (inputs: unknown, options: { readonly locale: SupportedLocale }) => string

/** the compiled messages a product's build left beside it, one module per locale */
export const loadMessageTable = async (productRoot: string): Promise<MessageTable> => {
  const index = path.join(productRoot, '.qualy', 'i18n', 'server', 'messages', '_index.js')
  if (!fs.existsSync(index)) {
    throw new Error(
      `the compiled messages are not at ${index}: compile them (pnpm i18n) before starting`,
    )
  }
  const table = (await import(pathToFileURL(index).href)) as Record<string, Say>
  return { lookup: (namespace, key) => table[`${namespace}.${key}`] }
}

/** loads and installs the product's compiled messages, for a process about to answer */
export const installProductMessages = async (productRoot: string): Promise<void> => {
  installMessageTable(await loadMessageTable(productRoot))
}
