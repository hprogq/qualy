import {
  compareDecimal,
  DATE_MAXIMUM,
  DATE_MINIMUM,
  DECIMAL_MAXIMUM,
  DECIMAL_MINIMUM,
  IN_MATERIAL_RANGE,
  kindOf,
  MAX_SCALE,
  parseDecimal,
  type AtomicSchema,
  type ChoiceSchema,
  type DateSchema,
  type DecimalSchema,
  type IntegerSchema,
  type TextSchema,
} from '@qualy/value-schema'

/**
 * A determination's field as the approve form offers it: the contract the
 * round opened under, narrowed to what today's question still admits.
 *
 * The decision refuses a value either one refuses, so the form offers only
 * what both admit - fewer options, a tighter range, a shorter text - rather
 * than letting the reviewer find out by being refused. Where the two share
 * nothing, or are not the same kind of value, the frozen field stands: that
 * is a reshaping the save already refuses while rounds are open, and the
 * decision says so field by field.
 */
export const admittedToday = (frozen: AtomicSchema, today: AtomicSchema): AtomicSchema => {
  const kind = kindOf(frozen)
  if (kindOf(today) !== kind) return frozen
  switch (kind) {
    case 'choice': {
      const admitted = new Set((today as ChoiceSchema).enum)
      const offered = (frozen as ChoiceSchema).enum.filter((value) => admitted.has(value))
      return offered.length === 0 ? frozen : ({ ...frozen, enum: offered } as ChoiceSchema)
    }
    case 'integer': {
      const was = frozen as IntegerSchema
      const now = today as IntegerSchema
      const minimum = Math.max(was.minimum, now.minimum)
      const maximum = Math.min(was.maximum, now.maximum)
      return minimum > maximum ? frozen : { ...was, minimum, maximum }
    }
    case 'decimal': {
      const was = frozen as DecimalSchema
      const now = today as DecimalSchema
      const tighter = (a: string | undefined, b: string | undefined, keep: -1 | 1) => {
        if (a === undefined) return b
        if (b === undefined) return a
        const left = parseDecimal(a)
        const right = parseDecimal(b)
        if (left === null || right === null) return a
        return compareDecimal(left, right) === keep ? a : b
      }
      const minimum = tighter(was[DECIMAL_MINIMUM], now[DECIMAL_MINIMUM], 1)
      const maximum = tighter(was[DECIMAL_MAXIMUM], now[DECIMAL_MAXIMUM], -1)
      const low = minimum === undefined ? null : parseDecimal(minimum)
      const high = maximum === undefined ? null : parseDecimal(maximum)
      if (low !== null && high !== null && compareDecimal(low, high) === 1) return frozen
      return {
        ...was,
        [MAX_SCALE]: Math.min(was[MAX_SCALE], now[MAX_SCALE]),
        ...(minimum === undefined ? {} : { [DECIMAL_MINIMUM]: minimum }),
        ...(maximum === undefined ? {} : { [DECIMAL_MAXIMUM]: maximum }),
      }
    }
    case 'date': {
      const was = frozen as DateSchema
      const now = today as DateSchema
      // full dates written YYYY-MM-DD order as their text does
      const pick = (a: string | undefined, b: string | undefined, later: boolean) =>
        a === undefined ? b : b === undefined ? a : a > b === later ? a : b
      const minimum = pick(was[DATE_MINIMUM], now[DATE_MINIMUM], true)
      const maximum = pick(was[DATE_MAXIMUM], now[DATE_MAXIMUM], false)
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) return frozen
      // the round's window binds the date when either version says it does
      const inRange = was[IN_MATERIAL_RANGE] === true || now[IN_MATERIAL_RANGE] === true
      return {
        ...was,
        ...(minimum === undefined ? {} : { [DATE_MINIMUM]: minimum }),
        ...(maximum === undefined ? {} : { [DATE_MAXIMUM]: maximum }),
        ...(inRange ? { [IN_MATERIAL_RANGE]: true } : {}),
      }
    }
    case 'text': {
      const was = frozen as TextSchema
      const now = today as TextSchema
      const bound = (a: number | undefined, b: number | undefined, pick: typeof Math.max) =>
        a === undefined ? b : b === undefined ? a : pick(a, b)
      const minLength = bound(was.minLength, now.minLength, Math.max)
      const maxLength = bound(was.maxLength, now.maxLength, Math.min)
      if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
        return frozen
      }
      // one pattern per field: where today's version asks for one, the form
      // asks for today's, since that is the one the decision holds the text
      // to; the frozen one stands only where today's asks for none
      const pattern = now.pattern ?? was.pattern
      return {
        ...was,
        ...(minLength === undefined ? {} : { minLength }),
        ...(maxLength === undefined ? {} : { maxLength }),
        ...(pattern === undefined ? {} : { pattern }),
      }
    }
    case 'boolean':
      return frozen
  }
}
