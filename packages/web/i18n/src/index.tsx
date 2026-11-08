import { createContext, useContext } from 'react'
import { defaultLocale, supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import { formatList } from './list.ts'

export {
  formatPlatformFailure,
  getApiErrorCode,
  isApiError,
  isApiErrorCode,
  isAuthenticationError,
  isTransportError,
  isBackendUnavailable,
  isUseCaseApiFailure,
  type UseCaseApiFailure,
  assertNever,
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
// Shared infrastructure failures are formatted here. Domain failures stay
// with their calling use case; server presentation DTOs arrive rendered.

/**
 * The document's language, said by whoever rendered it.
 *
 * A document rendered on a server is rendered before any root is marked, and
 * that server renders many documents at once; it says which language this one
 * is in here, and the page that hydrates says the same, so both draw the same
 * words. Absent, the root's mark decides, as it always has in a page that
 * renders itself.
 */
export const DocumentLocaleContext = createContext<SupportedLocale | undefined>(undefined)

/** The fixed language of this document. */
export function useLocale(): SupportedLocale {
  return useContext(DocumentLocaleContext) ?? resolveInitialLocale()
}

/**
 * An enumeration in the reader's own language.
 *
 * Compact lists use the catalog's separator, with no conjunction before
 * the last item. This stays identical across server and browser runtimes,
 * whose Intl list-formatting data can differ.
 */
export function useList(): (items: readonly string[]) => string {
  const locale = useLocale()
  return (items) => formatList(items, locale)
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
