import {
  defaultLocale,
  supportedLocales,
  type ErrorMessageMap,
  type SupportedLocale,
} from '@qualy/i18n-contract'
import { formatApiError } from './format.ts'

export {
  formatApiError,
  getApiErrorCode,
  isApiError,
  isApiErrorCode,
  isAuthenticationError,
  isTransportError,
  isBackendUnavailable,
} from './format.ts'
export { onLocaleChosenElsewhere, reopenInLocale } from './locale-channel.ts'

// The page's language, and the few things that are said by code rather than
// by a message a screen calls itself.
//
// A message is a compiled function each package imports from its own
// `#messages` (docs/adr/0011-i18n-paraglide.md): it reads the page's language
// off the root, where the shell's boot script marked it before the first
// frame, and it arrives in the same chunk as the code that says it. Nothing
// here loads, activates or re-renders anything: a page keeps one language
// from the moment it opens, and choosing another opens the page again.
//
// What remains is what a screen cannot say by itself: an api failure by its
// code, which may be any plugin's. Whatever else the server sends, it has
// already said in the page's language.

let errorRegistry: ErrorMessageMap = {}

/**
 * What the assembly's plugins say for their api failures. Installed once by
 * the composition root, before the first render; a test installs what its
 * screen needs.
 */
export function installMessages(installed: { readonly errorMessages?: ErrorMessageMap }): void {
  errorRegistry = installed.errorMessages ?? {}
}

/** an api failure, in the reader's words, from its code */
export function formatError(error: unknown, registry?: ErrorMessageMap): string {
  return formatApiError(error, registry ? { ...errorRegistry, ...registry } : errorRegistry)
}

export interface I18nRuntime {
  readonly locale: SupportedLocale
  readonly formatError: (error: unknown, registry?: ErrorMessageMap) => string
}

/** the page's language and a failure's words, as a screen reaches for them */
export function useI18n(): I18nRuntime {
  return { locale: resolveInitialLocale(), formatError }
}

/** the language this page is written in, from the moment it opened until it closes */
export function useLocale(): SupportedLocale {
  return useI18n().locale
}

/**
 * An enumeration in the reader's own language.
 *
 * The separator between two names is language, not data: components joined
 * with the ideographic comma directly, so an en-US reader was shown Chinese
 * punctuation inside a sentence that had been translated around it. The
 * platform knows the rule for every locale it serves, so no catalog needs a
 * key for a comma.
 *
 * `unit` rather than `conjunction`: these are lists of things - names,
 * tokens, units - and none of them wants an "and" before the last one.
 */
export function useList(): (items: readonly string[]) => string {
  const { locale } = useI18n()
  // conjunction-narrow, not unit-narrow: a unit list in Chinese has no
  // separator at all, so three names came out as one run-together word. This
  // is the one form that is a plain enumeration in both languages - "A、B、C"
  // and "A, B, C" - with no "and" before the last, which a list of names in
  // a table cell does not want either.
  return (items) =>
    new Intl.ListFormat(locale, { type: 'conjunction', style: 'narrow' }).format(items)
}

const isSupported = (value: string | null | undefined): value is SupportedLocale =>
  !!value && (supportedLocales as readonly string[]).includes(value)

// stored preference, then the caller's ranked languages (exact match first,
// then language subtag), then the deployment default. Pure so the ordering
// is testable; a signed-in user's stored preference feeds `stored` once
// user preferences exist.
export function resolveLocale(input: {
  stored?: string | null
  preferred?: readonly string[]
}): SupportedLocale {
  if (isSupported(input.stored)) return input.stored
  for (const candidate of input.preferred ?? []) {
    if (isSupported(candidate)) return candidate
    const match = supportedLocales.find(
      (locale) => locale.split('-')[0] === candidate.split('-')[0],
    )
    if (match) return match
  }
  return defaultLocale
}

// The locale is resolved once, before the first frame: the shell's boot
// script walks the same chain and marks the root with its answer, and the
// application takes the mark rather than deciding again - two deciders
// were, for the theme, a frame in which the two disagreed. The chain is
// walked here only where no script marked the root: a test, a document
// that is not the shell.
const ROOT_MARK = 'locale'

export function resolveInitialLocale(): SupportedLocale {
  const marked =
    typeof document === 'undefined' ? undefined : document.documentElement.dataset[ROOT_MARK]
  if (isSupported(marked)) return marked
  return resolveLocale({
    stored: storedLocale(),
    preferred: typeof navigator === 'undefined' ? [] : (navigator.languages ?? []),
  })
}

/** what somebody chose in this browser, kept as the cookie every page opens by */
const storedLocale = (): string | null => {
  if (typeof document === 'undefined') return null
  const found = /(?:^|;\s*)qualy\.locale=([^;]*)/.exec(document.cookie)
  return found?.[1] ?? null
}

export const localeNames: Record<SupportedLocale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
}
