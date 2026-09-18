import { describe, expect, it } from 'vitest'
import { workerDependencyScan } from '../src/dependency-scan.ts'

// Whether the dependency scanner can see into a worker.
//
// Deliberately about the SHAPE and not about any package. What broke was a
// plugin whose browser code starts a worker that imports a syntax
// highlighter, but naming that highlighter in a test would pin the fix to the
// one plugin that happened to hit it first - and the property worth keeping is
// that a plugin nobody has written yet, installed from outside this
// repository, gets the same treatment without the host learning anything
// about it.
//
// So the subject is a module that starts a worker, and the question is whether
// the scanner is handed an edge to walk.

const run = (code: string, id = '/x/page.ts') => {
  const plugin = workerDependencyScan()
  return plugin.transform.handler(code, id)
}

/** the added lines, which is all this plugin ever contributes */
const added = (code: string, id?: string) => {
  const out = run(code, id)
  return out === null ? [] : out.code.slice(code.length).trim().split('\n').filter(Boolean)
}

describe('the edge a worker does not express as an import', () => {
  it('follows the form Vite itself recognises', () => {
    expect(
      added(`const w = new Worker(new URL('./highlight.worker.ts', import.meta.url), {
        type: 'module',
      })`),
    ).toEqual(['import "./highlight.worker.ts"'])
  })

  it('follows a shared worker, and a quote of any kind', () => {
    expect(added(`new SharedWorker(new URL("./a.worker.ts", import.meta.url))`)).toEqual([
      'import "./a.worker.ts"',
    ])
    expect(added('new Worker(new URL(`./b.worker.ts`, import.meta.url))')).toEqual([
      'import "./b.worker.ts"',
    ])
  })

  it('names each worker once, however many times it is started', () => {
    expect(
      added(`
        new Worker(new URL('./one.worker.ts', import.meta.url), { type: 'module' })
        new Worker(new URL('./one.worker.ts', import.meta.url), { type: 'module' })
        new Worker(new URL('./two.worker.ts', import.meta.url), { type: 'module' })
      `),
    ).toEqual(['import "./one.worker.ts"', 'import "./two.worker.ts"'])
  })

  it('leaves alone what Vite cannot follow either', () => {
    // a computed url is not something the bundler can build a worker from, so
    // claiming to have found its dependencies would be claiming more than the
    // pipeline delivers
    expect(added('new Worker(new URL(where, import.meta.url))')).toEqual([])
    expect(added('new Worker(new URL(`./${name}.worker.ts`, import.meta.url))')).toEqual([])
    expect(added("new Worker('./plain.worker.ts')")).toEqual([])
    // a package specifier is one the scanner already walks
    expect(added("new Worker(new URL('some-package/worker.js', import.meta.url))")).toEqual([])
  })

  it('touches nothing that has no worker in it', () => {
    expect(run("import './a.ts'\nexport const x = 1")).toBeNull()
  })

  it('stays out of installed packages, where the optimizer runs it too', () => {
    // Vite hands the same plugin array to the dependency optimizer's own
    // bundle run, whose inputs are resolved package entries; this has nothing
    // to say there
    expect(
      run(
        "new Worker(new URL('./w.js', import.meta.url))",
        '/repo/node_modules/some-package/dist/index.js',
      ),
    ).toBeNull()
  })

  it('filters on the two things it needs before parsing anything', () => {
    const { filter } = workerDependencyScan().transform
    expect(filter.id!.test('/x/page.tsx')).toBe(true)
    expect(filter.id!.test('/x/styles.css')).toBe(false)
    expect(filter.code!.test('new Worker(')).toBe(true)
    expect(filter.code!.test('const worker = null')).toBe(false)
  })
})
