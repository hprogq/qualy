import { Ajv2020 } from 'ajv/dist/2020.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parameterSchemaAt } from '../src/diagnose.ts'
import {
  normalizeAtomicSchema,
  normalizeInputSchema,
  type AtomicSchema,
  type InputSchema,
} from '../src/profile.ts'
import { validateValue } from '../src/validate.ts'

// the validator takes NORMALIZED schemas only: the brand is what lets its
// compile cache key by identity, so every fixture goes through the factory
const atomic = (schema: AtomicSchema) => normalizeAtomicSchema(schema)
const input = (schema: InputSchema) => normalizeInputSchema(schema)

const decimal = atomic({
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': 2,
  'x-qualy-minimum': '1.00',
  'x-qualy-maximum': '6.00',
})

const reasons = (schema: Parameters<typeof validateValue>[0], value: unknown) =>
  validateValue(schema, value).map((issue) => issue.reason)

describe('instance validation', () => {
  it('judges decimals by the frozen semantics', () => {
    expect(reasons(decimal, '3.5')).toEqual([])
    // trailing zeros are lexical noise: the semantic digits fit the scale
    expect(reasons(decimal, '3.1400')).toEqual([])
    expect(reasons(decimal, '3.145')).toEqual(['x-qualy-maxScale'])
    expect(reasons(decimal, '0.5')).toEqual(['x-qualy-minimum'])
    expect(reasons(decimal, '7')).toEqual(['x-qualy-maximum'])
    // lexical failure is the format's verdict alone — bounds abstain
    expect(reasons(decimal, '03')).toEqual(['format'])
    expect(reasons(decimal, 3.5)).toEqual(['type'])
  })

  it('never coerces, defaults or strips', () => {
    expect(reasons(atomic({ type: 'integer', minimum: 1, maximum: 10 }), '3')).toEqual(['type'])
    expect(reasons(atomic({ type: 'boolean' }), 'true')).toEqual(['type'])
    const shape = input({
      type: 'object',
      properties: { n: { type: 'integer', minimum: 0, maximum: 9 } },
      required: ['n'],
      additionalProperties: false,
    })
    expect(reasons(shape, {})).toEqual(['required'])
    const extra = { n: 3, stray: 1 }
    expect(reasons(shape, extra)).toEqual(['additionalProperties'])
    // removeAdditional stays off: the judged object is untouched
    expect(extra).toEqual({ n: 3, stray: 1 })
  })

  it('walks every property and reports paths', () => {
    const shape = input({
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['a', 'b'] },
        when: { type: 'string', format: 'date' },
      },
      required: ['level', 'when'],
      additionalProperties: false,
    })
    const issues = validateValue(shape, { level: 'c', when: '2026-02-29' })
    expect(issues).toContainEqual({ path: '/level', reason: 'enum' })
    expect(issues).toContainEqual({ path: '/when', reason: 'format' })
  })
})

describe('prototype names as parameters, judged fail-closed', () => {
  // A parameter may legally be called `constructor` or `toString` (only
  // `__proto__` is refused by the profile). Ajv's required check reads
  // through the prototype - `({}).constructor` is not undefined - but the
  // type check then meets a function and refuses it, so a missing value
  // NEVER passes. This suite pins that end-to-end behaviour: if an ajv
  // upgrade or option change ever lets a prototype member through as a
  // value, this goes red before any caller does.
  const contract = (name: string) =>
    normalizeInputSchema({
      type: 'object',
      properties: { [name]: { type: 'integer', minimum: 0, maximum: 9 } },
      required: [name],
      additionalProperties: false,
    })

  it('refuses an empty object however the required name spells', () => {
    for (const name of ['constructor', 'toString', 'valueOf']) {
      expect(validateValue(contract(name), {}), name).not.toEqual([])
    }
  })

  it('accepts an own value, on a plain and a null-prototype carrier alike', () => {
    for (const name of ['constructor', 'toString', 'valueOf']) {
      expect(validateValue(contract(name), { [name]: 3 }), name).toEqual([])
      const bare = Object.assign(Object.create(null), { [name]: 3 })
      expect(validateValue(contract(name), bare), name).toEqual([])
    }
  })

  it('answers an issue path with an own parameter schema or nothing', () => {
    // the diagnosis face reads the same record: a path derived from data
    // must never hand back Object.prototype's members as schemas
    const spoken = contract('constructor')
    expect(parameterSchemaAt(spoken, '/constructor')).toBe(spoken.properties['constructor'])
    expect(parameterSchemaAt(contract('level'), '/constructor')).toBeUndefined()
    expect(parameterSchemaAt(contract('level'), '/toString')).toBeUndefined()
  })
})

describe('the frozen pattern engine inside ajv', () => {
  it('compiles each pattern once and never crosses instances', () => {
    // pinned because ajv keys its codegen scope by the engine result's
    // toString(): a shared key silently reuses the FIRST compiled pattern
    // for every later one (measured before the unique key existed)
    const plates = atomic({ type: 'string', pattern: '^[A-Z][0-9]{6}$' })
    const beads = atomic({ type: 'string', pattern: '^b+$' })
    expect(validateValue(plates, 'A123456')).toEqual([])
    expect(validateValue(plates, 'bbb').map((issue) => issue.reason)).toEqual(['pattern'])
    expect(validateValue(beads, 'bbb')).toEqual([])
    expect(validateValue(beads, 'A123456').map((issue) => issue.reason)).toEqual(['pattern'])
  })

  it('finishes a would-be catastrophic input in linear time', () => {
    const tricky = atomic({ type: 'string', pattern: '(a|a)*b', maxLength: 10_000 })
    const bait = `${'a'.repeat(2_000)}c`
    const began = performance.now()
    const issues = validateValue(tricky, bait)
    expect(performance.now() - began).toBeLessThan(200)
    expect(issues.map((issue) => issue.reason)).toEqual(['pattern'])
  })
})

describe('one validator per meaning, in bounded generations', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('compiles once for every object that spells the same schema', () => {
    const compile = vi.spyOn(Ajv2020.prototype, 'compile')
    // three objects, one meaning: what a caller that decodes its plan per
    // request hands over
    const spelled = [1, 2, 3].map(() => atomic({ type: 'string', pattern: '^plate-[a-z]{3}$' }))
    expect(spelled[0]).not.toBe(spelled[1])
    expect(reasons(spelled[0]!, 'plate-abc')).toEqual([])
    expect(reasons(spelled[1]!, 'plate-abc')).toEqual([])
    expect(reasons(spelled[2]!, 'PLATE')).toEqual(['pattern'])
    expect(compile).toHaveBeenCalledTimes(1)
    // the people-facing layer never moves the meaning: words, locales,
    // labels and the order choices are offered in
    const choice = atomic({ type: 'string', enum: ['sea', 'sky'] })
    const relabeled = atomic({
      type: 'string',
      enum: ['sky', 'sea'],
      title: 'Where',
      description: 'The element to report',
      'x-qualy-enumLabels': { sea: 'Sea', sky: 'Sky' },
      'x-qualy-i18n': { 'en-GB': { title: 'Whereabouts' } },
    })
    expect(reasons(choice, 'sea')).toEqual([])
    expect(reasons(relabeled, 'sea')).toEqual([])
    expect(reasons(relabeled, 'land')).toEqual(['enum'])
    expect(compile).toHaveBeenCalledTimes(2)
    // an input contract likewise, whatever order its parameters are shown in
    const contract = (order: readonly string[]) =>
      input({
        type: 'object',
        properties: { hours: { type: 'integer', minimum: 0, maximum: 24 }, where: choice },
        required: ['hours', 'where'],
        additionalProperties: false,
        'x-qualy-order': order,
      })
    expect(reasons(contract(['hours', 'where']), { hours: 3, where: 'sea' })).toEqual([])
    expect(reasons(contract(['where', 'hours']), { hours: 3, where: 'sea' })).toEqual([])
    expect(reasons(contract(['where', 'hours']), { hours: 25, where: 'sea' })).toEqual(['maximum'])
    expect(compile).toHaveBeenCalledTimes(3)
    // a different meaning is a different validator, and neither answers for the other
    const other = atomic({ type: 'string', pattern: '^plate-[0-9]{3}$' })
    expect(reasons(other, 'plate-123')).toEqual([])
    expect(reasons(other, 'plate-abc')).toEqual(['pattern'])
    expect(reasons(spelled[0]!, 'plate-123')).toEqual(['pattern'])
    expect(compile).toHaveBeenCalledTimes(4)
  })

  it('starts a fresh ajv when a generation is full, and lets the old one go', () => {
    // build() registers two formats on every new instance: each pair is a generation
    const built = vi.spyOn(Ajv2020.prototype, 'addFormat')
    const compile = vi.spyOn(Ajv2020.prototype, 'compile')
    // more meanings than two generations hold, each compiled exactly once
    const meaning = (n: number) => atomic({ type: 'integer', minimum: 0, maximum: n })
    for (let n = 1; n <= 600; n++) expect(reasons(meaning(n), 0)).toEqual([])
    expect(compile).toHaveBeenCalledTimes(600)
    expect(built.mock.calls.length / 2).toBeGreaterThanOrEqual(2)
    // the first meaning went with its generation and compiles again in the
    // current one; the last is still held
    expect(reasons(meaning(1), 0)).toEqual([])
    expect(compile).toHaveBeenCalledTimes(601)
    expect(reasons(meaning(600), 0)).toEqual([])
    expect(compile).toHaveBeenCalledTimes(601)
  })
})
