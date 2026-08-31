import { FORMULA_ABI_VERSION } from '@qualy/formula'
import { SANDBOX_ABI_VERSION } from '@qualy/sandbox-rpc'
import {
  VALUE_SCHEMA_PROFILE_VERSION,
  validateAtomicProfile,
  validateInputProfile,
} from '@qualy/value-schema'
import { REGEX_PROFILE_VERSION, patternIssues } from '@qualy/value-schema/regex'

// Whether THIS build can faithfully execute a stored version - a pure
// policy, decided from the row's own facts and nothing else.
//
// A supported version number means "we hold evidence this historical
// language replays under the current reader", never merely "the number is
// in a set" - and the evidence has to be about ACCEPTANCE semantics, not
// canonical bytes. Profile 1 is NOT supported: the 2026-08-31 inventory
// showed every v1 row's stored contract hash reproducible under the
// current canonicalizer, but that only proves the schema bytes never
// drifted - while still calling itself v1, the language swapped its regex
// engine for the RE2 dialect, its date validation for calendar arithmetic,
// and grew ceilings and prototype refusals, none of which move a schema's
// hash. A v1 row remains fully readable publication history; it is just
// not a certified runtime version until someone implements
// validateStoredValueSchemaV1 against the historical semantics and bears
// it with era-accurate fixtures. Growing these sets is a decision made
// HERE, with that evidence attached - v3 does not get in by bumping a
// constant.
//
// Deliberately absent from the input type: every provenance field.
// typescriptVersion, esbuildVersion, quickjsEngineVersion, buildIds and
// source-policy versions describe how a version was made, not whether it
// can run; an equality gate on any of them would kill every historical
// version on the next routine toolchain upgrade. Replayability across
// engine upgrades is the sandbox release suite's burden, not a per-row
// string comparison.

export interface RuntimeCompatibilityIssue {
  readonly facet:
    | 'formula-abi'
    | 'sandbox-abi'
    | 'value-schema-profile'
    | 'regex-profile'
    | 'input-schema'
    | 'output-schema'
  readonly reason: string
  readonly stored?: number
}

export const SUPPORTED_FORMULA_ABI: ReadonlySet<number> = new Set([FORMULA_ABI_VERSION])
export const SUPPORTED_SANDBOX_ABI: ReadonlySet<number> = new Set([SANDBOX_ABI_VERSION])
export const SUPPORTED_VALUE_SCHEMA_PROFILES: ReadonlySet<number> = new Set([
  VALUE_SCHEMA_PROFILE_VERSION,
])
export const SUPPORTED_REGEX_PROFILES: ReadonlySet<number> = new Set([REGEX_PROFILE_VERSION])

/**
 * The stored schemas judged under an explicitly named profile version.
 *
 * The version dispatch lives in this body on purpose: when v3 narrows the
 * language, what v1 and v2 rows are held to is a decision written here,
 * not an accident of whichever validator happens to be current.
 */
export const validateStoredValueSchema = (
  profileVersion: number,
  inputSchema: unknown,
  outputSchema: unknown,
): readonly RuntimeCompatibilityIssue[] => {
  if (!SUPPORTED_VALUE_SCHEMA_PROFILES.has(profileVersion)) {
    return [
      {
        facet: 'value-schema-profile',
        reason: 'no acceptance-semantics evidence for this value-schema profile',
        stored: profileVersion,
      },
    ]
  }
  const issues: RuntimeCompatibilityIssue[] = []
  for (const wrong of validateInputProfile(inputSchema)) {
    issues.push({ facet: 'input-schema', reason: `${wrong.path} ${wrong.reason}` })
  }
  for (const wrong of validateAtomicProfile(outputSchema)) {
    issues.push({ facet: 'output-schema', reason: `${wrong.path} ${wrong.reason}` })
  }
  return issues
}

/**
 * The stored patterns judged under an explicitly named regex profile.
 *
 * The structural check (validateInputProfile) only says a `pattern` is a
 * string; whether it belongs to the profile's RE2 dialect is this pass -
 * the same split every publication entry point already honors. An
 * unsupported dialect version returns its own issue and NEVER runs the
 * current interpreter over the stored pattern: judging another dialect's
 * program by this one's rules would be exactly the false confidence this
 * gate exists to refuse.
 */
export const storedPatternIssues = (
  regexProfileVersion: number,
  inputSchema: unknown,
  outputSchema: unknown,
): readonly RuntimeCompatibilityIssue[] => {
  if (!SUPPORTED_REGEX_PROFILES.has(regexProfileVersion)) {
    return [
      {
        facet: 'regex-profile',
        reason: 'no acceptance-semantics evidence for this regex profile',
        stored: regexProfileVersion,
      },
    ]
  }
  return [...patternIssues(inputSchema), ...patternIssues(outputSchema)].map((wrong) => ({
    facet: 'regex-profile' as const,
    reason: `${wrong.path} ${wrong.reason}`,
  }))
}

export const checkRuntimeCompatibility = (version: {
  readonly formulaAbiVersion: number
  readonly sandboxAbiVersion: number
  readonly valueSchemaProfileVersion: number
  readonly regexProfileVersion: number
  readonly inputSchema: unknown
  readonly outputSchema: unknown
}): readonly RuntimeCompatibilityIssue[] => {
  const issues: RuntimeCompatibilityIssue[] = []
  if (!SUPPORTED_FORMULA_ABI.has(version.formulaAbiVersion)) {
    issues.push({
      facet: 'formula-abi',
      reason: 'this host does not speak this formula abi',
      stored: version.formulaAbiVersion,
    })
  }
  if (!SUPPORTED_SANDBOX_ABI.has(version.sandboxAbiVersion)) {
    issues.push({
      facet: 'sandbox-abi',
      reason: 'this host does not speak this sandbox abi',
      stored: version.sandboxAbiVersion,
    })
  }
  issues.push(
    ...storedPatternIssues(version.regexProfileVersion, version.inputSchema, version.outputSchema),
  )
  issues.push(
    ...validateStoredValueSchema(
      version.valueSchemaProfileVersion,
      version.inputSchema,
      version.outputSchema,
    ),
  )
  return issues
}
