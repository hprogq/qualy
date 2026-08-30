import { describe, expect, it } from 'vitest'
import {
  assignmentPlan,
  canonicalizeAtomicSchema,
  canonicalizeInputSchema,
  choiceLabel,
  displayDescription,
  displayTitle,
  inputOrder,
  normalizeAtomicSchema,
  normalizeInputSchema,
  validateAtomicProfile,
  validateInputProfile,
  type AtomicSchema,
  type ChoiceSchema,
  type InputSchema,
} from '@qualy/value-schema'

// The annotation layer's whole contract: words for people that validation,
// assignability and hashing can never see - plus the one input-level
// annotation (display order) that keeps authored order without giving JSON
// property order semantics.

const titled = (title: string): AtomicSchema => ({
  type: 'integer',
  minimum: 1,
  maximum: 10,
  title,
  description: 'the rank in the award hierarchy',
  'x-qualy-i18n': { 'en-US': { title: `${title} (en)` } },
})

describe('annotations never move the semantic identity', () => {
  it('relabeling changes no canonical byte and no assignment verdict', () => {
    const a = titled('奖项序位')
    const b = titled('Award rank')
    expect(canonicalizeAtomicSchema(a)).toBe(canonicalizeAtomicSchema(b))
    const bare: AtomicSchema = { type: 'integer', minimum: 1, maximum: 10 }
    expect(canonicalizeAtomicSchema(a)).toBe(canonicalizeAtomicSchema(bare))
    expect(assignmentPlan(a, b)).toEqual({ kind: 'direct' })
  })

  it('the input order annotation stays out of the canonical body', () => {
    const ordered: InputSchema = {
      type: 'object',
      properties: {
        b: { type: 'boolean' },
        a: { type: 'boolean' },
      },
      required: ['a', 'b'],
      additionalProperties: false,
      'x-qualy-order': ['b', 'a'],
    }
    const unordered: InputSchema = {
      type: 'object',
      properties: { a: { type: 'boolean' }, b: { type: 'boolean' } },
      required: ['a', 'b'],
      additionalProperties: false,
    }
    expect(canonicalizeInputSchema(ordered)).toBe(canonicalizeInputSchema(unordered))
  })

  it('normalize keeps the words, byte-stably across authoring key order', () => {
    const one = normalizeAtomicSchema({
      type: 'boolean',
      'x-qualy-i18n': { 'zh-CN': { title: '是否获奖' }, 'en-US': { title: 'Awarded' } },
    } as AtomicSchema)
    const two = normalizeAtomicSchema({
      type: 'boolean',
      'x-qualy-i18n': { 'en-US': { title: 'Awarded' }, 'zh-CN': { title: '是否获奖' } },
    } as AtomicSchema)
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
    const input = normalizeInputSchema({
      type: 'object',
      properties: { z: { type: 'boolean' }, a: { type: 'boolean' } },
      required: ['a', 'z'],
      additionalProperties: false,
      'x-qualy-order': ['z', 'a'],
    })
    // semantic parts sort; the display order survives as authored
    expect(Object.keys(input.properties)).toEqual(['a', 'z'])
    expect(input['x-qualy-order']).toEqual(['z', 'a'])
  })
})

describe('the annotation layer is still a checked shape', () => {
  it('refuses malformed words, locales and orders', () => {
    expect(
      validateAtomicProfile({ type: 'boolean', title: 42 }).map((issue) => issue.reason),
    ).toContain('annotation-not-a-string')
    expect(
      validateAtomicProfile({ type: 'boolean', title: 'x'.repeat(300) }).map((one) => one.reason),
    ).toContain('annotation-too-long')
    expect(
      validateAtomicProfile({
        type: 'boolean',
        'x-qualy-i18n': { 'not a locale!': { title: 'x' } },
      }).map((one) => one.reason),
    ).toContain('locale-invalid')
    expect(
      validateAtomicProfile({
        type: 'boolean',
        'x-qualy-i18n': { 'en-US': { enumLabels: { a: 'A' } } },
      }).map((one) => one.reason),
    ).toContain('labels-without-choices')
    expect(
      validateAtomicProfile({
        type: 'string',
        enum: ['a'],
        'x-qualy-i18n': { 'en-US': { enumLabels: { ghost: 'Ghost' } } },
      }).map((one) => one.reason),
    ).toContain('label-orphan')
    const base = {
      type: 'object',
      properties: { a: { type: 'boolean' } },
      required: ['a'],
      additionalProperties: false,
    }
    for (const order of [['a', 'a'], ['b'], [], ['a', 'b']]) {
      expect(
        validateInputProfile({ ...base, 'x-qualy-order': order }).map((one) => one.reason),
        JSON.stringify(order),
      ).toContain('order-not-a-permutation')
    }
    expect(validateInputProfile({ ...base, 'x-qualy-order': ['a'] })).toEqual([])
  })
})

describe('how a screen reads the words', () => {
  const choice: ChoiceSchema = {
    type: 'string',
    enum: ['national', 'provincial'],
    'x-qualy-enumLabels': { national: '国家级', provincial: '省级' },
    title: '赛事级别',
    'x-qualy-i18n': {
      'en-US': { title: 'Competition level', enumLabels: { national: 'National' } },
    },
  }

  it('walks locale, default, then the machine identity', () => {
    expect(displayTitle(choice, 'level', 'en-US')).toBe('Competition level')
    expect(displayTitle(choice, 'level', 'zh-CN')).toBe('赛事级别')
    expect(displayTitle({ type: 'boolean' }, 'flag', 'zh-CN')).toBe('flag')
    expect(displayDescription({ type: 'boolean', description: 'd' }, 'zh-CN')).toBe('d')
    expect(choiceLabel(choice, 'national', 'en-US')).toBe('National')
    expect(choiceLabel(choice, 'provincial', 'en-US')).toBe('省级')
    expect(choiceLabel(choice, 'provincial', 'zh-CN')).toBe('省级')
    expect(choiceLabel({ type: 'string', enum: ['raw'] }, 'raw', 'zh-CN')).toBe('raw')
  })

  it('reads business keys as own properties, never off the prototype', () => {
    // a choice's stable value may legally spell an Object.prototype name;
    // a partial locale record must then FALL THROUGH, not hand back the
    // inherited machinery - a function where a label belongs
    for (const value of ['toString', 'constructor', '__proto__']) {
      const spelled: ChoiceSchema = {
        type: 'string',
        enum: [value],
        'x-qualy-enumLabels': Object.fromEntries([[value, '默认名称']]) as Record<string, string>,
        'x-qualy-i18n': { 'zh-CN': { enumLabels: {} } },
      }
      // locale record exists but has no OWN entry: the default label wins
      expect(choiceLabel(spelled, value, 'zh-CN')).toBe('默认名称')
      // an own locale entry wins as usual
      const translated: ChoiceSchema = {
        ...spelled,
        'x-qualy-i18n': {
          'zh-CN': {
            enumLabels: Object.fromEntries([[value, '本地名称']]) as Record<string, string>,
          },
        },
      }
      expect(choiceLabel(translated, value, 'zh-CN')).toBe('本地名称')
      // nothing anywhere: the stable value itself, still a string
      const bare: ChoiceSchema = { type: 'string', enum: [value] }
      const answer = choiceLabel(bare, value, 'zh-CN')
      expect(answer).toBe(value)
      expect(typeof answer).toBe('string')
    }
    // and the locale key itself is read the same way
    expect(choiceLabel({ type: 'string', enum: ['x'] }, 'x', 'constructor')).toBe('x')
  })

  it('renders parameters in the authored order, falling back to key order', () => {
    const input: InputSchema = {
      type: 'object',
      properties: { a: { type: 'boolean' }, z: { type: 'boolean' } },
      required: ['a', 'z'],
      additionalProperties: false,
      'x-qualy-order': ['z', 'a'],
    }
    expect(inputOrder(input)).toEqual(['z', 'a'])
    expect(
      inputOrder({
        type: 'object',
        properties: { a: { type: 'boolean' } },
        required: ['a'],
        additionalProperties: false,
      }),
    ).toEqual(['a'])
  })
})

describe('the canonical json primitive', () => {
  it('is blind to key order and faithful to array order', async () => {
    const { hashCanonicalJson, canonicalJson } = await import('@qualy/value-schema/hash')
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
    expect(hashCanonicalJson({ b: 1, a: 2 })).toBe(hashCanonicalJson({ a: 2, b: 1 }))
    expect(hashCanonicalJson([1, 2])).not.toBe(hashCanonicalJson([2, 1]))
    expect(hashCanonicalJson({ a: undefined, b: 1 })).toBe(hashCanonicalJson({ b: 1 }))
    expect(hashCanonicalJson(null)).toBe(hashCanonicalJson(null))
    expect(hashCanonicalJson('x')).not.toBe(hashCanonicalJson(['x']))
  })
})
