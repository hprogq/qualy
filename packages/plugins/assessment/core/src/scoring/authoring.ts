/**
 * Where a submitted scoring configuration becomes its stored form.
 *
 * The V2 authoring language separates what a browser drafts from what a
 * revision stores. A draft names its recognitions by client-local handles,
 * because a new recognition has no identity until this module mints one; a
 * stored configuration is keyed by those minted UUIDs and nothing else.
 * Everything downstream of a save - change detection, the reason gate,
 * compilation, impact, the appended revision - consumes the normalized
 * form, so a client re-spelling its handles is not a change and a stored
 * configuration re-submitted verbatim is a no-op.
 *
 * A legacy configuration (no `version` key) passes through untouched: that
 * language belongs to the V1 compiler and never tightens. Identity rules
 * for V2 are strict: an id must be one this item's current stored V2
 * configuration already declares - inventing one, borrowing a deleted one,
 * or sharing one between two recognitions is refused, and a recognition
 * removed and re-added is a NEW identity, never a revival.
 */

import { Effect, Schema } from 'effect'
import { PROFILE_LIMITS, validateAtomicProfile, type AtomicSchema } from '@qualy/value-schema'
import { patternIssues } from '@qualy/value-schema/regex'

export interface AuthoringIssue {
  readonly path: string
  readonly reason: string
}

/** the stored V2 language: recognitions keyed by server-minted identity */
export interface StoredScoringAuthoringV2 {
  readonly version: 2
  readonly calculator: { readonly ref: string; readonly config: unknown }
  readonly aggregator: { readonly ref: string; readonly config: unknown }
  readonly recognitions: Readonly<
    Record<
      string,
      {
        readonly label: string
        readonly refinement: AtomicSchema | null
        readonly defaultFromFieldId: string | null
      }
    >
  >
  readonly bindings: Readonly<
    Record<
      string,
      | { readonly kind: 'constant'; readonly value: unknown }
      | { readonly kind: 'recognition'; readonly recognitionId: string }
    >
  >
}

/** the draft V2 language: an array, so duplicate handles and ids are
 *  detectable and every refusal can point at an index */
export interface ScoringAuthoringDraftV2 {
  readonly version: 2
  readonly calculator: { readonly ref: string; readonly config: unknown }
  readonly aggregator: { readonly ref: string; readonly config: unknown }
  readonly recognitions: readonly {
    readonly handle: string
    readonly id?: string
    readonly label: string
    readonly refinement: AtomicSchema | null
    readonly defaultFromFieldId: string | null
  }[]
  readonly bindings: Readonly<
    Record<
      string,
      | { readonly kind: 'constant'; readonly value: unknown }
      | { readonly kind: 'recognition'; readonly handle: string }
    >
  >
}

const UUIDV7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const wrapper = Schema.Struct({ ref: Schema.String, config: Schema.Unknown })

const draftShape = Schema.Struct({
  version: Schema.Literal(2),
  calculator: wrapper,
  aggregator: wrapper,
  recognitions: Schema.Array(
    Schema.Struct({
      handle: Schema.String,
      id: Schema.optional(Schema.String),
      label: Schema.String,
      refinement: Schema.NullOr(Schema.Unknown),
      defaultFromFieldId: Schema.NullOr(Schema.String),
    }),
  ),
  bindings: Schema.Record(
    Schema.String,
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('constant'), value: Schema.Unknown }),
      Schema.Struct({ kind: Schema.Literal('recognition'), handle: Schema.String }),
    ]),
  ),
})

const storedShape = Schema.Struct({
  version: Schema.Literal(2),
  calculator: wrapper,
  aggregator: wrapper,
  recognitions: Schema.Record(
    Schema.String,
    Schema.Struct({
      label: Schema.String,
      refinement: Schema.NullOr(Schema.Unknown),
      defaultFromFieldId: Schema.NullOr(Schema.String),
    }),
  ),
  bindings: Schema.Record(
    Schema.String,
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('constant'), value: Schema.Unknown }),
      Schema.Struct({ kind: Schema.Literal('recognition'), recognitionId: Schema.String }),
    ]),
  ),
})

// the V2 envelope refuses unknown keys instead of stripping them; the
// calculator and aggregator configs and the refinement bodies stay their
// owners' languages (see docs/notes/effect.md on the rc.111 default)
const decodeStrict = <A>(schema: Schema.Codec<A>, value: unknown) =>
  Effect.option(Schema.decodeUnknownEffect(schema)(value, { onExcessProperty: 'error' }))

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

/** ids declared by the item's CURRENT stored V2 configuration - the only
 *  identities a submission may carry forward */
const currentIds = (current: unknown): ReadonlySet<string> => {
  if (current === null || typeof current !== 'object' || Array.isArray(current)) return new Set()
  const record = current as Record<string, unknown>
  if (!Object.hasOwn(record, 'version') || record['version'] !== 2) return new Set()
  const recognitions = record['recognitions']
  if (recognitions === null || typeof recognitions !== 'object' || Array.isArray(recognitions)) {
    return new Set()
  }
  return new Set(Object.keys(recognitions))
}

/** early, index-addressed structural issues for one refinement; the
 *  compiler re-proves the merged schema later and stays the single source */
const refinementIssues = (path: string, refinement: unknown): readonly AuthoringIssue[] => {
  if (refinement === null) return []
  if (validateAtomicProfile(refinement).length > 0) {
    return [{ path, reason: 'refinement-not-in-profile' }]
  }
  if (patternIssues(refinement).length > 0) {
    return [{ path, reason: 'refinement-pattern-outside-dialect' }]
  }
  return []
}

const sortedRecord = <T>(entries: readonly (readonly [string, T])[]): Record<string, T> =>
  Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/**
 * Normalize one submitted scoring configuration against the item's current
 * stored one. Legacy passes through byte-for-byte; a V2 draft becomes the
 * stored form (minting identities for its new recognitions, in ordinal
 * order); a stored V2 form re-submitted verbatim normalizes to itself.
 */
export const normalizeScoringAuthoring = <E, R>(input: {
  readonly current: unknown
  readonly submitted: unknown
  readonly mint: (count: number) => Effect.Effect<readonly string[], E, R>
}): Effect.Effect<
  { readonly config: unknown } | { readonly issues: readonly AuthoringIssue[] },
  E,
  R
> =>
  Effect.gen(function* () {
    const submitted = input.submitted
    if (submitted === null || typeof submitted !== 'object' || Array.isArray(submitted)) {
      // not an object at all: the V1 compiler owns the refusal
      return { config: submitted }
    }
    if (!Object.hasOwn(submitted, 'version')) {
      // the legacy language, exactly as written: it has no identities to
      // mint and no strictness to hold, and it never gains either
      return { config: submitted }
    }
    const version = (submitted as Record<string, unknown>)['version']
    if (version !== 2) {
      return {
        issues: [{ path: 'scoringConfig.version', reason: 'authoring-version-unsupported' }],
      }
    }
    const recognitions = (submitted as Record<string, unknown>)['recognitions']
    return Array.isArray(recognitions)
      ? yield* normalizeDraft(submitted, input.current, input.mint)
      : yield* normalizeStored(submitted, input.current)
  })

const normalizeDraft = <E, R>(
  submitted: object,
  current: unknown,
  mint: (count: number) => Effect.Effect<readonly string[], E, R>,
) =>
  Effect.gen(function* () {
    const decoded = yield* decodeStrict(
      draftShape as unknown as Schema.Codec<ScoringAuthoringDraftV2>,
      submitted,
    )
    if (decoded._tag === 'None') {
      return { issues: [{ path: 'scoringConfig', reason: 'scoring-config-shape' }] as const }
    }
    const draft = decoded.value
    const issues: AuthoringIssue[] = []
    // the ceiling comes BEFORE any minting: a hostile draft must not buy
    // thousands of identities on its way to being refused
    if (draft.recognitions.length > PROFILE_LIMITS.inputParameters) {
      issues.push({ path: 'scoringConfig.recognitions', reason: 'too-many-recognitions' })
      return { issues }
    }
    const known = currentIds(current)
    const handles = new Set<string>()
    const carried = new Set<string>()
    draft.recognitions.forEach((one, index) => {
      const at = `scoringConfig.recognitions[${index}]`
      if (handles.has(one.handle)) {
        issues.push({ path: `${at}.handle`, reason: 'recognition-handle-reused' })
      }
      handles.add(one.handle)
      if (one.id !== undefined) {
        if (!UUIDV7_SHAPE.test(one.id)) {
          issues.push({ path: `${at}.id`, reason: 'recognition-id-invalid' })
        } else if (!known.has(one.id)) {
          // inventing an identity, or reviving a deleted one: both refused -
          // a re-added recognition is a new fact and gets a new identity
          issues.push({ path: `${at}.id`, reason: 'recognition-id-unknown' })
        } else if (carried.has(one.id)) {
          issues.push({ path: `${at}.id`, reason: 'recognition-id-reused' })
        }
        carried.add(one.id)
      }
      issues.push(...refinementIssues(`${at}.refinement`, one.refinement))
    })
    for (const [parameter, binding] of Object.entries(draft.bindings)) {
      if (binding.kind === 'recognition' && !handles.has(binding.handle)) {
        issues.push({ path: `scoringConfig.bindings.${parameter}`, reason: 'recognition-unknown' })
      }
    }
    if (issues.length > 0) return { issues }

    const unminted = draft.recognitions.filter((one) => one.id === undefined)
    const minted = unminted.length === 0 ? [] : yield* mint(unminted.length)
    let next = 0
    const idByHandle = new Map<string, string>()
    for (const one of draft.recognitions) {
      idByHandle.set(one.handle, one.id ?? minted[next++]!)
    }
    const config: StoredScoringAuthoringV2 = {
      version: 2,
      calculator: { ref: draft.calculator.ref, config: draft.calculator.config },
      aggregator: { ref: draft.aggregator.ref, config: draft.aggregator.config },
      recognitions: sortedRecord(
        draft.recognitions.map(
          (one) =>
            [
              idByHandle.get(one.handle)!,
              {
                label: one.label,
                refinement: one.refinement as AtomicSchema | null,
                defaultFromFieldId: one.defaultFromFieldId,
              },
            ] as const,
        ),
      ),
      bindings: sortedRecord(
        Object.entries(draft.bindings).map(
          ([parameter, binding]) =>
            [
              parameter,
              binding.kind === 'constant'
                ? binding
                : { kind: 'recognition' as const, recognitionId: idByHandle.get(binding.handle)! },
            ] as const,
        ),
      ),
    }
    return { config: config as unknown }
  })

const normalizeStored = (submitted: object, current: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* decodeStrict(
      storedShape as unknown as Schema.Codec<StoredScoringAuthoringV2>,
      submitted,
    )
    if (decoded._tag === 'None') {
      return { issues: [{ path: 'scoringConfig', reason: 'scoring-config-shape' }] as const }
    }
    const stored = decoded.value
    const issues: AuthoringIssue[] = []
    const ids = Object.keys(stored.recognitions)
    if (ids.length > PROFILE_LIMITS.inputParameters) {
      issues.push({ path: 'scoringConfig.recognitions', reason: 'too-many-recognitions' })
      return { issues }
    }
    const known = currentIds(current)
    for (const id of ids) {
      const at = `scoringConfig.recognitions.${id}`
      if (!UUIDV7_SHAPE.test(id)) {
        issues.push({ path: at, reason: 'recognition-id-invalid' })
      } else if (!known.has(id)) {
        issues.push({ path: at, reason: 'recognition-id-unknown' })
      }
      issues.push(...refinementIssues(`${at}.refinement`, own(stored.recognitions, id)!.refinement))
    }
    for (const [parameter, binding] of Object.entries(stored.bindings)) {
      if (
        binding.kind === 'recognition' &&
        !Object.hasOwn(stored.recognitions, binding.recognitionId)
      ) {
        issues.push({ path: `scoringConfig.bindings.${parameter}`, reason: 'recognition-unknown' })
      }
    }
    if (issues.length > 0) return { issues }
    const config: StoredScoringAuthoringV2 = {
      version: 2,
      calculator: { ref: stored.calculator.ref, config: stored.calculator.config },
      aggregator: { ref: stored.aggregator.ref, config: stored.aggregator.config },
      recognitions: sortedRecord(Object.entries(stored.recognitions)),
      bindings: sortedRecord(Object.entries(stored.bindings)),
    }
    return { config: config as unknown }
  })
