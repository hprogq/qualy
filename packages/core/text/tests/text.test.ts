import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createTextRenderer,
  isText,
  literal,
  render,
  renderTexts,
  term,
  text,
  type MessageRef,
} from '../src/index.ts'
import { loadMessageTable, messageRefs } from '../src/node.ts'

// What the server says, said: against the product's own compiled messages,
// which the suite's setup installs as a started server does.

const repoRoot = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const moduleOf = (relative: string) => pathToFileURL(path.join(repoRoot, relative)).href

describe('a message named from the module that declares it', () => {
  // the namespace comes from the package that holds the module, and it has
  // to be the one the compiler merged that package's keys under
  const org = messageRefs<Record<string, (inputs?: Record<string, never>) => string>>(
    moduleOf('packages/plugins/base/org/src/index.ts'),
  )

  it('is said in the language asked for', () => {
    const said = text(org.navigation_organization!)
    expect(render(said, { locale: 'zh-CN' })).toBe('组织架构')
    expect(render(said, { locale: 'en-US' })).toBe('Organization tree')
  })

  it('is a name until it is said, and survives a structured clone', () => {
    const said = text(org.navigation_organization!)
    expect(isText(said)).toBe(true)
    expect(structuredClone(said)).toEqual(said)
  })
})

describe('what fills a message', () => {
  const assessment = messageRefs<Record<string, (inputs: { count: number }) => string>>(
    moduleOf('packages/plugins/assessment/core/src/index.ts'),
  )

  it('is formatted by the message, in its language', () => {
    const said = text(assessment.review_summaryCount!, { count: 1 })
    expect(render(said, { locale: 'en-US' })).toBe('1 field')
    expect(
      render(text(assessment.review_summaryCount!, { count: 1234 }), { locale: 'en-US' }),
    ).toBe('1,234 fields')
  })
})

describe('business data and terms', () => {
  it('says business data as it stands, in every language', () => {
    expect(render(literal('软件学院'), { locale: 'en-US' })).toBe('软件学院')
  })

  it("says a term in the tenant's words, and its own where the tenant has none", () => {
    const said = term({ id: 'auth/user-number' })
    expect(render(said, { locale: 'zh-CN', terms: new Map([['auth/user-number', '学号']]) })).toBe(
      '学号',
    )
    expect(render(said, { locale: 'en-US', termDefault: () => 'User number' })).toBe('User number')
    expect(() => render(said, { locale: 'en-US' })).toThrow(/auth\/user-number/)
  })
})

describe('an answer said whole', () => {
  it('says every text however deep, and leaves everything else alone', () => {
    const when = new Date('2026-10-01T00:00:00Z')
    const answer = {
      kinds: [{ type: 'oidc', label: literal('OIDC'), fields: [{ hint: literal('x'), n: 1 }] }],
      none: null,
      when,
    }
    const said = renderTexts(answer, { locale: 'en-US' })
    expect(said).toEqual({
      kinds: [{ type: 'oidc', label: 'OIDC', fields: [{ hint: 'x', n: 1 }] }],
      none: null,
      when,
    })
    // a Date is a value, not a record to walk into
    expect(said.when).toBe(when)
  })
})

describe('a message that cannot be said', () => {
  it('names what is missing', () => {
    const missing: MessageRef = { namespace: 'qualy-plugin-org', key: 'no_suchMessage' }
    expect(() => render(text(missing), { locale: 'en-US' })).toThrow(/no_suchMessage/)
  })

  it('refuses where no messages were compiled', async () => {
    await expect(loadMessageTable(path.join(repoRoot, 'no-such-product'))).rejects.toThrow(
      /pnpm i18n/,
    )
  })
})

describe('declaration validation', () => {
  it('rejects incomplete references and malformed nested inputs', () => {
    for (const value of [
      { kind: 'message', ref: {} },
      { kind: 'message', ref: { namespace: 'n', key: 'k' }, inputs: [] },
      { kind: 'message', ref: { namespace: 'n', key: 'k' }, inputs: { value: null } },
      { kind: 'term', term: { id: 42 } },
    ])
      expect(isText(value)).toBe(false)
    const cycle = {
      kind: 'message',
      ref: { namespace: 'n', key: 'k' },
      inputs: {} as Record<string, unknown>,
    }
    cycle.inputs.self = cycle
    expect(isText(cycle)).toBe(false)
  })
})

it('isolates explicit renderers and their nested texts', () => {
  const a = createTextRenderer({
    lookup: () => (inputs) => `a:${(inputs as { value?: string }).value ?? ''}`,
  })
  const b = createTextRenderer({
    lookup: () => (inputs) => `b:${(inputs as { value?: string }).value ?? ''}`,
  })
  const ref: MessageRef<{ value: string }> = { namespace: 'n', key: 'k' }
  const said = text(ref, { value: text(ref, { value: 'x' }) })
  expect(a.render(said, { locale: 'en-US' })).toBe('a:a:x')
  expect(b.renderTexts({ said }, { locale: 'en-US' })).toEqual({ said: 'b:b:x' })
})
