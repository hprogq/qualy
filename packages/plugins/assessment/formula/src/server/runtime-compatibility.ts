import { FORMULA_ABI_VERSION } from '@qualy/formula'
import { SANDBOX_ABI_VERSION } from '@qualy/sandbox-rpc'
import {
  VALUE_SCHEMA_PROFILE_VERSION,
  validateAtomicProfile,
  validateInputProfile,
} from '@qualy/value-schema'
import { REGEX_PROFILE_VERSION } from '@qualy/value-schema/regex'

// Whether THIS build can faithfully execute a stored version - a pure
// policy, decided from the row's own facts and nothing else.
//
// A supported version number means "we hold evidence this historical
// language replays under the current reader", never merely "the number is
// in a set". Value-schema profile 1 is supported because every v1 row was
// inventoried (2026-08-31, five rows): each canonicalizes under the current
// reader to its own stored contract hash, byte for byte. Growing or
// shrinking these sets is a decision made HERE, with fresh replay evidence
// attached - v3 does not get in by bumping a constant.
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
  1,
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
        reason: 'no replay evidence for this value-schema profile',
        stored: profileVersion,
      },
    ]
  }
  // v1 ⊂ v2 by inventory: both are judged by the current reader's profile
  const issues: RuntimeCompatibilityIssue[] = []
  for (const wrong of validateInputProfile(inputSchema)) {
    issues.push({ facet: 'input-schema', reason: `${wrong.path} ${wrong.reason}` })
  }
  for (const wrong of validateAtomicProfile(outputSchema)) {
    issues.push({ facet: 'output-schema', reason: `${wrong.path} ${wrong.reason}` })
  }
  return issues
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
  if (!SUPPORTED_REGEX_PROFILES.has(version.regexProfileVersion)) {
    issues.push({
      facet: 'regex-profile',
      reason: 'no replay evidence for this regex profile',
      stored: version.regexProfileVersion,
    })
  }
  issues.push(
    ...validateStoredValueSchema(
      version.valueSchemaProfileVersion,
      version.inputSchema,
      version.outputSchema,
    ),
  )
  return issues
}
