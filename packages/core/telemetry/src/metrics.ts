import { Effect, Metric } from 'effect'

// Business metrics with a bounded label space, by construction.
//
// A time-series backend prices every distinct label combination, and one
// leaked UUID or user-typed string turns a metric into an unbounded series
// factory. The constructors here are the only way business code records a
// qualy.* metric: every attribute key is declared up front, every value must
// come from the declared list, and a value that arrives outside the list -
// through a cast, a widened type, a bug - is clamped to 'other' instead of
// becoming a label. The type keeps honest callers honest at compile time;
// the clamp keeps the series space bounded at runtime.

export interface BoundedAttributes {
  readonly [key: string]: readonly [string, ...string[]]
}

// the declared union keeps completion and typo-catching for literal callers;
// the `string & {}` arm admits genuinely dynamic sources (a driver type read
// from a row), whose values the runtime clamp bounds
type AttributesOf<S extends BoundedAttributes> = {
  readonly [K in keyof S]: S[K][number] | (string & {})
}

const clamp = <S extends BoundedAttributes>(
  spec: S,
  attributes: AttributesOf<S>,
): Record<string, string> => {
  const bounded: Record<string, string> = {}
  for (const key of Object.keys(spec)) {
    const value = (attributes as Record<string, unknown>)[key]
    bounded[key] = typeof value === 'string' && spec[key]!.includes(value) ? value : 'other'
  }
  return bounded
}

/** a counter whose every label combination was declared before the first record */
export const boundedCounter = <const S extends BoundedAttributes>(name: string, spec: S) => {
  // incremental: a business count never goes down, and the exporter marks
  // the sum monotonic, which is what makes Prometheus render it as _total
  const base = Metric.counter(name, { incremental: true })
  return (attributes: AttributesOf<S>): Effect.Effect<void> =>
    Metric.update(Metric.withAttributes(base, clamp(spec, attributes)), 1)
}

/**
 * A duration histogram in seconds with the same bounded label space.
 *
 * The `unit` attribute is how the effect OTLP exporter declares a metric's
 * unit on the wire (it also surfaces as one constant label, which is the
 * upstream trade-off, not ours).
 */
export const boundedDurationHistogram = <const S extends BoundedAttributes>(
  name: string,
  spec: S,
  boundaries: readonly number[],
) => {
  const base = Metric.histogram(name, { boundaries: [...boundaries] })
  return (attributes: AttributesOf<S>, seconds: number): Effect.Effect<void> =>
    Metric.update(Metric.withAttributes(base, { unit: 's', ...clamp(spec, attributes) }), seconds)
}

/** the OTel semconv default bucket set for short operations, in seconds */
export const DURATION_BOUNDARIES = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
] as const
