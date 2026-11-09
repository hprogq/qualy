import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { expect, it } from 'vitest'
import { qualyChunkIdentity } from '../../../../apps/web/chunk-identity.ts'

it('changes an importer URL when it switches between byte-identical chunks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qualy-chunk-identity-'))
  const write = (name: string, content: string) => fs.writeFile(path.join(root, name), content)
  const buildWith = async (selected: 'left' | 'right') => {
    await write('entry.js', `import { seat } from './${selected}.js'; console.log(seat);`)
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [qualyChunkIdentity(root)],
      build: {
        write: false,
        rolldownOptions: {
          input: ['entry.js', 'left.js', 'right.js'].map((name) => path.join(root, name)),
          preserveEntrySignatures: 'strict',
          output: { preserveModules: true, entryFileNames: 'assets/c-[hash].js' },
        },
      },
    })
    if (!('output' in result)) throw new Error('Expected one output bundle')
    return (name: string) => {
      const chunk = result.output.find(
        (file) => file.type === 'chunk' && file.facadeModuleId?.endsWith(`/${name}.js`),
      )
      if (chunk?.type !== 'chunk') throw new Error(`Missing chunk: ${name}`)
      return chunk
    }
  }
  try {
    await write('left.js', 'export const seat = {};')
    await write('right.js', 'export const seat = {};')
    const first = await buildWith('left')
    const second = await buildWith('right')
    expect(first('left').code).toBe(first('right').code)
    expect(first('left').fileName).not.toBe(first('right').fileName)
    expect(second('left').fileName).toBe(first('left').fileName)
    expect(second('right').fileName).toBe(first('right').fileName)
    expect(first('entry').imports).toEqual([first('left').fileName])
    expect(second('entry').imports).toEqual([second('right').fileName])
    expect(second('entry').fileName).not.toBe(first('entry').fileName)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
