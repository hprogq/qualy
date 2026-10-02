import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  compileMessages,
  messageSourceAt,
  messageSources,
  messagesOutDir,
  readMessages,
} from '../src/compile.ts'

const directories: string[] = []
const source = (en: unknown, zh: unknown, owner = '@acme/example') => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-messages-'))
  directories.push(root)
  fs.mkdirSync(path.join(root, 'messages'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: owner,
      type: 'module',
      imports: { '#messages': './.qualy/messages.js' },
    }),
  )
  fs.writeFileSync(path.join(root, 'qualy.yml'), 'version: 3\nplugins: {}\n')
  fs.writeFileSync(path.join(root, 'messages/en-US.json'), JSON.stringify(en))
  fs.writeFileSync(path.join(root, 'messages/zh-CN.json'), JSON.stringify(zh))
  return messageSourceAt(root)
}
afterEach(() => {
  for (const root of directories.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

for (const [en, zh] of [
  ['{value, number}', '{value, date}'],
  ['{value, number}', '{value, select, a {a} other {b}}'],
  ['{value, date}', '{value, select, a {a} other {b}}'],
]) {
  it(`rejects incompatible translation contracts: ${en} / ${zh}`, () => {
    expect(() => readMessages([source({ example: en }, { example: zh })])).toThrow(
      /incompatible input kinds/,
    )
  })
}
it('rejects conflicting kinds within one message too', () => {
  expect(() =>
    readMessages([source({ example: '{value, date} {value, number}' }, { example: '{value}' })]),
  ).toThrow(/incompatible input kinds/)
})
it('allows plain interpolation to share a numeric or temporal input', () => {
  expect(
    readMessages([
      source({ example: '{value}' }, { example: '{value, number}' }),
    ]).compiled[0]!.inputs.get('value'),
  ).toBe('number')
})
for (const invalid of [null, [], { example: 123 }, { example: false }]) {
  it(`rejects malformed JSON messages: ${JSON.stringify(invalid)}`, () => {
    expect(() => readMessages([source(invalid, { example: '示例' })])).toThrow(
      /JSON object|must be a string/,
    )
  })
}
it('compiles once, skips unchanged inputs, and repairs missing browser/server/facade output', async () => {
  const s = source({ example: 'Hello {name}' }, { example: '你好{name}' })
  const options = {
    manifestPath: path.join(s.packageRoot, 'qualy.yml'),
    sources: [s],
    outputStructure: 'locale-modules' as const,
  }
  const result = await compileMessages(options)
  expect(result.compiled).toBe(true)
  expect((await compileMessages(options)).compiled).toBe(false)
  for (const file of [
    path.join(result.outDir, 'server/messages/_index.js'),
    path.join(result.outDir, 'paraglide/messages/_index.js'),
    path.join(result.outDir, 'facades/acme-example.d.ts'),
    path.join(s.packageRoot, '.qualy/messages.d.ts'),
  ]) {
    fs.rmSync(file)
    expect((await compileMessages(options)).compiled).toBe(true)
    expect(fs.existsSync(file)).toBe(true)
  }
  fs.writeFileSync(
    path.join(s.packageRoot, 'messages/en-US.json'),
    JSON.stringify({ example: 'Hi {name}' }),
  )
  expect((await compileMessages(options)).compiled).toBe(true)
})
it('serializes concurrent writers to one product output tree', async () => {
  const s = source({ example: 'Hello {name}' }, { example: '你好{name}' })
  const options = {
    manifestPath: path.join(s.packageRoot, 'qualy.yml'),
    sources: [s],
    outputStructure: 'locale-modules' as const,
    force: true,
  }
  const [first, second] = await Promise.all([compileMessages(options), compileMessages(options)])
  expect(first.compiled).toBe(true)
  expect(second.compiled).toBe(true)
  expect(fs.existsSync(path.join(first.outDir, 'stamp.json'))).toBe(true)
  expect(fs.existsSync(path.join(first.outDir, 'compile.lock'))).toBe(false)
})
it('isolates a Vite source profile from the default compiler output', async () => {
  const core = source({ example: 'Core' }, { example: '核心' })
  const fixture = source({ probe: 'Probe' }, { probe: '探针' }, '@acme/probe')
  const manifestPath = path.join(core.packageRoot, 'qualy.yml')
  const profile = 'extra-test-fixture'

  await compileMessages({
    manifestPath,
    sources: [core, fixture],
    outputStructure: 'locale-modules',
    outputProfile: profile,
  })
  const fixtureFacade = path.join(
    messagesOutDir(core.packageRoot, profile),
    'facades/acme-probe.js',
  )
  expect(fs.existsSync(fixtureFacade)).toBe(true)

  await compileMessages({
    manifestPath,
    sources: [core],
    outputStructure: 'locale-modules',
    force: true,
  })
  expect(fs.existsSync(fixtureFacade)).toBe(true)
  expect(fs.readFileSync(fixtureFacade, 'utf8')).toContain('probe')
})
it('keeps Vite build and dev output structures in separate profiles', async () => {
  const s = source({ one: 'One', two: 'Two' }, { one: '一', two: '二' })
  const manifestPath = path.join(s.packageRoot, 'qualy.yml')
  const built = await compileMessages({
    manifestPath,
    sources: [s],
    outputStructure: 'message-modules',
    outputProfile: 'vite-build',
  })
  const buildOutputs = (
    JSON.parse(fs.readFileSync(path.join(built.outDir, 'stamp.json'), 'utf8')) as {
      outputs: { file: string }[]
    }
  ).outputs.map(({ file }) => file)

  const served = await compileMessages({
    manifestPath,
    sources: [s],
    outputStructure: 'locale-modules',
    outputProfile: 'vite-dev',
  })
  expect(served.outDir).not.toBe(built.outDir)
  expect(buildOutputs.every((file) => fs.existsSync(file))).toBe(true)
})
it('refuses a stale lock instead of racing another waiter to delete it', async () => {
  const s = source({ example: 'Hello {name}' }, { example: '你好{name}' })
  const lock = path.join(messagesOutDir(s.packageRoot), 'compile.lock')
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  fs.writeFileSync(lock, `${JSON.stringify({ pid: 2_147_483_647, token: 'stale-owner' })}\n`)

  await expect(
    compileMessages({
      manifestPath: path.join(s.packageRoot, 'qualy.yml'),
      sources: [s],
      outputStructure: 'locale-modules',
      force: true,
    }),
  ).rejects.toThrow(/found stale lock/)
  expect(fs.readFileSync(lock, 'utf8')).toContain('stale-owner')
})
it('finds only active sources for releases, and validates a package with only one locale', async () => {
  const s = source({}, {})
  const nodeModules = path.join(s.packageRoot, 'node_modules')
  fs.mkdirSync(nodeModules)
  for (const name of ['active', 'disabled']) {
    const root = path.join(nodeModules, name)
    fs.mkdirSync(path.join(root, 'messages'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name, exports: { '.': './index.js', './package.json': './package.json' } }),
    )
    fs.writeFileSync(path.join(root, 'index.js'), '')
    fs.writeFileSync(path.join(root, 'messages/zh-CN.json'), '{}')
  }
  fs.writeFileSync(
    path.join(s.packageRoot, 'package.json'),
    JSON.stringify({ dependencies: { active: '*', disabled: '*' } }),
  )
  fs.writeFileSync(
    path.join(s.packageRoot, 'qualy.yml'),
    'version: 3\nplugins:\n  active: {}\n  disabled:\n    enabled: false\n',
  )
  const sources = await messageSources(path.join(s.packageRoot, 'qualy.yml'))
  expect(sources.map((s) => s.owner)).toContain('active')
  expect(sources.map((s) => s.owner)).not.toContain('disabled')
  expect(() => readMessages(sources)).toThrow(/en-US.json/)
  expect(
    (await messageSources(path.join(s.packageRoot, 'qualy.yml'), true)).map((s) => s.owner),
  ).toContain('disabled')
})
