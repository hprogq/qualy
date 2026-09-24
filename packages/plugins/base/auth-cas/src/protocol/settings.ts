import type { EntranceValue } from '@qualy/auth-contract/login'

// What one CAS entrance is told, and the endpoints that follows from it.
//
// An administrator names the server and a protocol version, and the standard
// endpoints of that version follow; the custom profile lets each endpoint be
// named instead, for a server that answers somewhere else - a school whose
// validation lives at /proxyValidate and wants a POST. What is stored is the
// expanded result, so a later change to what a profile expands to never
// moves an entrance that is already in service.

export type CasProtocol = 'cas3' | 'cas2' | 'cas1' | 'custom'
export type ValidateMethod = 'GET' | 'POST'
/** how a validation answer is read; `auto` reads the one answer it gets */
export type ResponseFormat = 'auto' | 'xml' | 'json' | 'text'

export type CasIdentity =
  | { readonly source: 'principal' }
  | {
      readonly source: 'attribute'
      /** as the server spells it: attribute names are not case-folded */
      readonly attribute: string
      readonly fallbackToPrincipal: boolean
    }

export interface CasSettings {
  readonly loginUrl: string
  readonly validateUrl: string
  readonly validateMethod: ValidateMethod
  readonly responseFormat: ResponseFormat
  readonly identity: CasIdentity
  /** ask the server for credentials again even when it has a session */
  readonly renew: boolean
}

/** what each standard version validates at, and what it answers in */
const PROFILES: Record<Exclude<CasProtocol, 'custom'>, { path: string; format: ResponseFormat }> = {
  cas3: { path: '/p3/serviceValidate', format: 'xml' },
  cas2: { path: '/serviceValidate', format: 'xml' },
  cas1: { path: '/validate', format: 'text' },
}

const PROTOCOLS: readonly CasProtocol[] = ['cas3', 'cas2', 'cas1', 'custom']

/** an absolute http(s) address that more can be appended to */
const baseOf = (raw: string): string | undefined => {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
      return undefined
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

/** an absolute http(s) endpoint, which may carry a query of its own */
const endpointOf = (raw: string): string | undefined => {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.hash !== '' || url.username !== '' || url.password !== '') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

const text = (value: EntranceValue | undefined) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/**
 * The settings the values stand for, or which field cannot stand.
 *
 * Values that are not there yet are not a refusal: an entrance is saved in
 * pieces, and until the server's address is known there is simply nothing to
 * expand. The defaults are the driver's own, the same ones its fields declare.
 */
export const settingsFrom = (
  values: Readonly<Record<string, EntranceValue | undefined>>,
):
  | { readonly ok: true; readonly settings?: CasSettings }
  | { readonly ok: false; readonly invalid: string } => {
  const protocol = (text(values['protocol']) ?? 'cas3') as CasProtocol
  if (!PROTOCOLS.includes(protocol)) return { ok: false, invalid: 'protocol' }

  const source = text(values['identitySource']) ?? 'principal'
  const attribute = text(values['identityAttribute'])
  // an attribute name is one token; a space is a typo, not a name
  if (attribute !== undefined && (attribute.length > 128 || /[\s<>&"']/.test(attribute))) {
    return { ok: false, invalid: 'identityAttribute' }
  }

  const server = text(values['serverUrl'])
  const base = server === undefined ? undefined : baseOf(server)
  if (server !== undefined && base === undefined) return { ok: false, invalid: 'serverUrl' }

  const custom = protocol === 'custom'
  const typedLogin = custom ? text(values['loginUrl']) : undefined
  const typedValidate = custom ? text(values['validateUrl']) : undefined
  const loginUrl = typedLogin === undefined ? undefined : endpointOf(typedLogin)
  if (typedLogin !== undefined && loginUrl === undefined) return { ok: false, invalid: 'loginUrl' }
  const validateUrl = typedValidate === undefined ? undefined : endpointOf(typedValidate)
  if (typedValidate !== undefined && validateUrl === undefined) {
    return { ok: false, invalid: 'validateUrl' }
  }

  if (base === undefined) return { ok: true }
  if (source === 'attribute' && attribute === undefined) return { ok: true }

  const profile = PROFILES[custom ? 'cas3' : protocol]
  return {
    ok: true,
    settings: {
      loginUrl: loginUrl ?? `${base}/login`,
      validateUrl: validateUrl ?? `${base}${profile.path}`,
      validateMethod: custom && values['validateMethod'] === 'POST' ? 'POST' : 'GET',
      responseFormat: custom
        ? ((text(values['responseFormat']) ?? 'auto') as ResponseFormat)
        : profile.format,
      identity:
        source === 'attribute'
          ? {
              source: 'attribute',
              attribute: attribute!,
              fallbackToPrincipal: values['identityFallback'] === true,
            }
          : { source: 'principal' },
      renew: values['renew'] === true,
    },
  }
}

const FORMATS: readonly ResponseFormat[] = ['auto', 'xml', 'json', 'text']

/** the stored expansion, when it is one this version can read */
const storedSettings = (value: unknown): CasSettings | undefined => {
  if (value === null || typeof value !== 'object') return undefined
  const stored = value as Record<string, unknown>
  const identity = stored['identity'] as Record<string, unknown> | null | undefined
  if (
    typeof stored['loginUrl'] !== 'string' ||
    typeof stored['validateUrl'] !== 'string' ||
    (stored['validateMethod'] !== 'GET' && stored['validateMethod'] !== 'POST') ||
    !FORMATS.includes(stored['responseFormat'] as ResponseFormat) ||
    typeof stored['renew'] !== 'boolean' ||
    identity === null ||
    typeof identity !== 'object'
  ) {
    return undefined
  }
  if (identity['source'] === 'principal') return stored as unknown as CasSettings
  if (
    identity['source'] === 'attribute' &&
    typeof identity['attribute'] === 'string' &&
    typeof identity['fallbackToPrincipal'] === 'boolean'
  ) {
    return stored as unknown as CasSettings
  }
  return undefined
}

/**
 * The settings an entrance in service runs with.
 *
 * What was expanded when it was saved; failing that - an entrance saved before
 * this driver stored its expansion - the same expansion worked out again.
 */
export const settingsOf = (config: Readonly<Record<string, unknown>>): CasSettings | undefined => {
  const stored = storedSettings(config['derived'])
  if (stored !== undefined) return stored
  const worked = settingsFrom(config as Record<string, EntranceValue | undefined>)
  return worked.ok ? worked.settings : undefined
}
