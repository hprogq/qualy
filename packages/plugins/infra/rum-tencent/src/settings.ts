// What this provider tells a browser about itself.
//
// A leaf with no dependencies, because both halves read it and they have
// nothing else in common: the server puts these fields into the capability's
// opaque `config`, and the browser reads them back before React exists.
//
// None of it is secret. The reporting id travels in every report the browser
// sends, so it is public by construction. The credentials that ARE secret
// belong to the source map uploader, which runs from a release pipeline and
// never reaches this process.

/** the code this plugin declares to the assembly, and answers to in the browser */
export const TENCENT_RUM_PROVIDER = 'tencent'

/**
 * The mainland reporting endpoint, fixed rather than configurable.
 *
 * A free-form host would let the data region, the content security policy and
 * the source map project drift apart from one another, and there is no
 * deployment of this product outside the mainland to serve. It is also the
 * sdk's own default, so this constant exists for the policy, which has to
 * name the host before any browser reaches it.
 */
export const TENCENT_RUM_HOST = 'https://rumt-zh.com'

/** the environments the vendor's sdk knows; a deployment picks one */
export const RUM_ENVIRONMENTS = ['production', 'pre', 'gray', 'daily', 'test', 'local'] as const

export type RumEnvironment = (typeof RUM_ENVIRONMENTS)[number]

export interface TencentRumPublicConfig {
  /** the browser reporting id, which is not the numeric source map project id */
  readonly id: string
  readonly environment: RumEnvironment
  /** 0 to 1 */
  readonly sampleRate: number
}

/**
 * Whether what the capability handed over is this provider's configuration.
 *
 * Checked rather than trusted, and checked without a decoder: this runs in the
 * boot graph of every page, and a schema here would be weight on every load to
 * re-verify something the server already validated at startup.
 */
export const isTencentRumPublicConfig = (value: unknown): value is TencentRumPublicConfig => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['id'] === 'string' &&
    candidate['id'] !== '' &&
    typeof candidate['environment'] === 'string' &&
    typeof candidate['sampleRate'] === 'number' &&
    candidate['sampleRate'] > 0 &&
    candidate['sampleRate'] <= 1
  )
}
