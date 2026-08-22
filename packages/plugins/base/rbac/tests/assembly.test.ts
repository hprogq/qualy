import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// The permissions capability writes an ordered list of plugin ids into
// qualy.lock.json, and that file is committed and hashed into
// resolutionHash. Two people whose manifests say the same thing must get the
// same lock, byte for byte, so the order may not depend on anything about the
// machine that resolved it - and localeCompare depends on exactly that.
//
// A locale cannot be changed inside a running process: ICU reads it once at
// startup. So the assertion is made in a child process that starts with a
// Scandinavian one, where 'aa' collates after 'z'.

const PROVIDER = new URL('../src/assembly/index.ts', import.meta.url).href

/** three ids whose collation and whose bytes disagree under a Danish locale */
const IDS = ['@fake/plugin-ab', '@fake/plugin-z', '@fake/plugin-aa']
const BY_CODEPOINT = ['@fake/plugin-aa', '@fake/plugin-ab', '@fake/plugin-z']

const CHILD = `
const provider = (await import(process.env.QUALY_PROVIDER)).default
const ids = ${JSON.stringify(IDS)}
const state = await provider.resolve({
  manifestPath: '/nowhere/qualy.yml',
  plugins: new Map(ids.map((id) => [id, { id, version: '0.0.0', state: 'active' }])),
  contributions: new Map(ids.map((id, at) => [id, { owner: id, codes: ['probe.' + at] }])),
  descriptors: new Map(),
  resolvePackageDir: () => '/nowhere',
  previousState: undefined,
})
console.log(JSON.stringify({ locale: Intl.Collator().resolvedOptions().locale, order: state.order }))
`

const resolveUnder = (locale: string): { locale: string; order: string[] } => {
  const printed = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', CHILD],
    {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: locale, LANG: locale, QUALY_PROVIDER: PROVIDER },
    },
  )
  const last = printed.trim().split('\n').at(-1)!
  return JSON.parse(last) as { locale: string; order: string[] }
}

describe('the permissions capability state', () => {
  it('orders by codepoint whatever the machine collates by', () => {
    const danish = resolveUnder('da_DK.UTF-8')
    // if the child fell back to another locale the fixture proves nothing:
    // 'aa' after 'z' is the whole point of choosing these three ids
    expect(danish.locale).toBe('da-DK')
    expect(danish.order).toEqual(BY_CODEPOINT)
    expect(resolveUnder('en_US.UTF-8').order).toEqual(danish.order)
  })
})
