import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'

// How the pages open in one browser hear that a language was chosen in one of
// them. Its own module: the release gate listens before anything else of the
// localization runtime has loaded.

const LOCALE_CHANNEL = 'qualy.locale'

/**
 * After a new language was chosen and kept: the other pages open in this
 * browser are told, and this one opens again in it. A page keeps one
 * language for as long as it is open, so choosing another is opening the
 * page again - the reload asks first, as any reload does, when something on
 * the page would be lost.
 */
export function reopenInLocale(locale: SupportedLocale): void {
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(LOCALE_CHANNEL)
    channel.postMessage({ locale })
    channel.close()
  }
  window.location.reload()
}

/** hears another page of this browser choose a language */
export function onLocaleChosenElsewhere(listener: (locale: SupportedLocale) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel(LOCALE_CHANNEL)
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const locale = (event.data as { locale?: unknown } | null)?.locale
    if (typeof locale === 'string' && (supportedLocales as readonly string[]).includes(locale))
      listener(locale as SupportedLocale)
  })
  return () => channel.close()
}
