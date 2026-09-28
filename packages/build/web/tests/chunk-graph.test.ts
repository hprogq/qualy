import { describe, expect, it } from 'vitest'
import { chunkRings, qualyChunkGraph, staticClosure } from '../src/chunk-graph.ts'

const graph = (edges: Record<string, string[]>) => new Map(Object.entries(edges))

describe('chunk rings', () => {
  it('finds none in a graph that only points one way', () => {
    expect(chunkRings(graph({ entry: ['a', 'b'], a: ['b'], b: [] }))).toEqual([])
  })

  it('finds two chunks that import each other, and a longer ring apart from it', () => {
    const rings = chunkRings(
      graph({
        entry: ['api', 'w'],
        api: ['errors'],
        errors: ['api'],
        w: ['x'],
        x: ['y'],
        y: ['z'],
        z: ['w'],
      }),
    )
    expect(rings).toHaveLength(2)
    expect(rings).toContainEqual(['api', 'errors'])
    expect(rings).toContainEqual(['w', 'x', 'y', 'z'])
  })

  it('does not count an import of something outside the bundle', () => {
    expect(chunkRings(graph({ a: ['react', 'b'], b: ['a-external'] }))).toEqual([])
  })
})

describe('the first screen', () => {
  it('is what the entry reaches through static imports, and nothing it only could', () => {
    const imports = graph({
      entry: ['shell'],
      shell: ['react'],
      react: [],
      page: ['editor'],
      editor: [],
    })
    expect([...staticClosure(imports, ['entry'])].sort()).toEqual(['entry', 'react', 'shell'])
  })
})

// The plugin itself, driven with the fields a build hands it.
const chunk = (
  fileName: string,
  imports: string[],
  modules: string[],
  size: number,
  isEntry = false,
) => ({
  type: 'chunk' as const,
  fileName,
  imports,
  modules: Object.fromEntries(modules.map((id) => [id, {}])),
  code: 'x'.repeat(size),
  isEntry,
})

/** what the check refused the bundle with, or nothing */
const run = (bundle: Record<string, ReturnType<typeof chunk>>, bootBudget: number) => {
  const plugin = qualyChunkGraph({ root: '/repo', bootBudget })
  const generate = plugin.generateBundle as (
    this: { error: (message: string) => never },
    options: unknown,
    bundle: unknown,
  ) => void
  let refused: string | undefined
  try {
    generate.call(
      {
        error: (message) => {
          refused = message
          throw new Error(message)
        },
      },
      {},
      bundle,
    )
  } catch (error) {
    if (refused === undefined) throw error
  }
  return refused
}

describe('the build check', () => {
  it('passes a bundle with no ring and a first screen inside its budget', () => {
    const bundle = {
      e: chunk('e.js', ['c.js'], ['/repo/apps/web/src/main.tsx'], 10, true),
      c: chunk('c.js', [], ['/repo/node_modules/react/index.js'], 10),
    }
    expect(run(bundle, 100)).toBeUndefined()
  })

  it('refuses a ring, naming the modules in each chunk of it', () => {
    const bundle = {
      e: chunk('e.js', ['a.js'], ['/repo/apps/web/src/main.tsx'], 10, true),
      a: chunk('a.js', ['b.js'], ['/repo/packages/plugins/assessment/core/src/api.ts'], 10),
      b: chunk('b.js', ['a.js'], ['/repo/packages/plugins/assessment/core/src/errors.ts'], 10),
    }
    const refused = run(bundle, 1000)
    expect(refused).toMatch(/import one another/)
    expect(refused).toContain('packages/plugins/assessment/core/src/api.ts')
    expect(refused).toContain('packages/plugins/assessment/core/src/errors.ts')
  })

  it('refuses a first screen over budget, naming what weighs it down', () => {
    const bundle = {
      e: chunk('e.js', ['big.js'], ['/repo/apps/web/src/main.tsx'], 10, true),
      big: chunk(
        'big.js',
        [],
        [
          '/repo/packages/web/runtime/src/navigation.tsx',
          '/repo/node_modules/.pnpm/monaco-editor@0.57.0/node_modules/monaco-editor/esm/vs/editor.js',
        ],
        500,
      ),
      // reached only through a dynamic import, so not part of the first screen
      page: chunk(
        'page.js',
        [],
        ['/repo/packages/plugins/assessment/core/src/client/Page.tsx'],
        5000,
      ),
    }
    const refused = run(bundle, 100)
    expect(refused).toMatch(/first screen imports/)
    expect(refused).toContain('monaco-editor')
    expect(run(bundle, 1000)).toBeUndefined()
  })
})
