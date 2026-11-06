import fs from 'node:fs'
import path from 'node:path'
import { parseAst } from 'vite'
import { walkSources } from '../lib/walk.ts'

// No server functions, for now (docs/adr/0012-rsc-data-mode.md).
//
// A `'use server'` directive turns a function into an endpoint a browser can
// call by reference - outside every api contract, its method and path never
// declared, its errors never coded, its audit never chosen. The render
// entry already declines to decode one; this keeps the source from declaring
// one, so that turning them on is a decision somebody makes in an ADR rather
// than a line somebody adds to a component.
//
// Read as syntax, not as text: only a directive counts - the first
// statements of a module or of a function body - so the words in a string,
// a comment or this file are not one.

/** where product source lives: every package and the web application */
export const productSourceRoots = (repoRoot: string): string[] => [
  path.join(repoRoot, 'apps/web/src'),
  ...fs
    .readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((group) => group.isDirectory())
    .flatMap((group) => {
      const groupDir = path.join(repoRoot, 'packages', group.name)
      const packages = fs.existsSync(path.join(groupDir, 'package.json'))
        ? [groupDir]
        : fs
            .readdirSync(groupDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(groupDir, entry.name))
      return packages.map((dir) => path.join(dir, 'src'))
    }),
]

interface Node {
  readonly type: string
  readonly directive?: string
  readonly start?: number
  readonly [key: string]: unknown
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'

/** the offsets of every `'use server'` directive in one module's source */
export const serverDirectivesIn = (source: string, file: string): number[] => {
  const found: number[] = []
  const prologue = (statements: unknown) => {
    if (!Array.isArray(statements)) return
    for (const statement of statements) {
      if (!isNode(statement) || statement.directive === undefined) return
      if (statement.directive === 'use server') found.push(statement.start ?? 0)
    }
  }
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!isNode(node)) return
    if (node.type === 'Program') prologue(node['body'])
    if (node.type === 'BlockStatement') prologue(node['body'])
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'parent' && typeof child === 'object') visit(child)
    }
  }
  visit(parseAst(source, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }))
  return found
}

/** every server function declared under the given roots, as `file:line` */
export const findServerFunctions = (roots: readonly string[]): string[] =>
  roots.flatMap((root) =>
    walkSources(root, ['tests', 'testkit']).flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8')
      if (!source.includes('use server')) return []
      return serverDirectivesIn(source, file).map(
        (offset) => `${file}:${String(source.slice(0, offset).split('\n').length)}`,
      )
    }),
  )

if (import.meta.main) {
  const repoRoot = path.resolve(import.meta.dirname, '../..')
  const found = findServerFunctions(productSourceRoots(repoRoot))
  if (found.length > 0) {
    console.error(
      `server functions are not enabled (docs/adr/0012-rsc-data-mode.md):\n${found.join('\n')}`,
    )
    process.exit(1)
  }
  console.log('no server functions declared')
}
