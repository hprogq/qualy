import { setupI18n, type I18n } from '@lingui/core'
import { compileMessage } from '@lingui/message-utils/compileMessage'
import {
  defaultLocale,
  supportedLocales,
  type ErrorMessageMap,
  type MessageCatalog,
  type MessageDescriptor,
  type MessageValues,
  type PluginCatalogs,
  type ValuesOf,
  type SupportedLocale,
  type UiText,
} from '@qualy/i18n-contract'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { formatApiError, type FormatArgs, type MessageFormatter } from './format.ts'

export { commonErrorMessages, formatApiError } from './format.ts'
export type { MessageFormatter } from './format.ts'

// the web localization runtime: one lingui core instance holding raw icu
// catalogs (compiled on demand, so catalogs stay plain typescript modules
// inside the normal typecheck and test pipeline) plus a small react binding.
// Plugins own their namespace and ship their own catalogs; this runtime only
// assembles, activates and falls back.

const STORAGE_KEY = 'qualy.locale'

export interface I18nRuntime extends MessageFormatter {
  locale: SupportedLocale
  setLocale(locale: SupportedLocale): void
  formatText(text: UiText): string
  formatError(error: unknown, registry?: ErrorMessageMap): string
}

const I18nContext = createContext<I18nRuntime | undefined>(undefined)

export function useI18n(): I18nRuntime {
  const runtime = use(I18nContext)
  if (!runtime) throw new Error('useI18n must be used inside <I18nProvider>')
  return runtime
}

export function useLocale(): [SupportedLocale, (locale: SupportedLocale) => void] {
  const { locale, setLocale } = useI18n()
  return [locale, setLocale]
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

export function resolveInitialLocale(): SupportedLocale {
  return resolveLocale({
    stored: typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY),
    preferred: typeof navigator === 'undefined' ? [] : (navigator.languages ?? []),
  })
}

// the runtime's own catalogs (common/*), shipped with this package
const commonCatalogs: Partial<
  Record<SupportedLocale, () => Promise<{ default: MessageCatalog }>>
> = {
  'zh-CN': () => import('./catalogs/zh-CN.ts'),
}

// namespaces never overlap (a test enforces that), so a flat merge is
// enough; a missing catalog is normal because english lives in the
// defaultMessage of each reference and a partial locale falls back per key
export async function loadCatalogs(
  locale: SupportedLocale,
  plugins: readonly PluginCatalogs[],
): Promise<MessageCatalog> {
  const sources = [commonCatalogs, ...plugins.map((plugin) => plugin.locales)]
  const loaded = await Promise.all(
    sources.map(async (locales) => {
      const load = locales[locale]
      return load ? (await load()).default : {}
    }),
  )
  return Object.assign({}, ...loaded) as MessageCatalog
}

export interface I18nProviderProps {
  // per-plugin catalogs, assembled by the web host from its plugin registry
  catalogs?: readonly PluginCatalogs[]
  // merged plugin error registry; formatError falls back to it so a page
  // never has to know which plugin owns the code it just received
  errorMessages?: ErrorMessageMap
  children: ReactNode
  // rendered until the first catalog activation completes, so the ui never
  // flashes untranslated english
  fallback?: ReactNode
}

export function I18nProvider({
  catalogs = [],
  errorMessages = {},
  children,
  fallback = null,
}: I18nProviderProps) {
  const i18n = useMemo<I18n>(() => {
    const instance = setupI18n()
    // raw icu strings are compiled lazily; no extraction or compile step
    instance.setMessagesCompiler(compileMessage)
    return instance
  }, [])
  const [locale, setLocaleState] = useState<SupportedLocale>(resolveInitialLocale)
  const [activated, setActivated] = useState<SupportedLocale | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const activate = (messages: MessageCatalog) => {
      if (cancelled) return
      i18n.load(locale, messages)
      i18n.activate(locale)
      document.documentElement.lang = locale
      setActivated(locale)
    }
    void loadCatalogs(locale, catalogs)
      .then(activate)
      .catch((error: unknown) => {
        // a chunk can go missing after a deploy; activating an empty catalog
        // renders the english defaults instead of hanging on the fallback
        console.error(`failed to load catalogs for ${locale}`, error)
        activate({})
      })
    return () => {
      cancelled = true
    }
  }, [i18n, locale, catalogs])

  const setLocale = useCallback((next: SupportedLocale) => {
    localStorage.setItem(STORAGE_KEY, next)
    setLocaleState(next)
  }, [])

  const runtime = useMemo<I18nRuntime>(() => {
    const format = <Descriptor extends MessageDescriptor>(
      descriptor: Descriptor,
      ...args: FormatArgs<ValuesOf<Descriptor>>
    ) =>
      i18n._({
        id: descriptor.id,
        message: descriptor.defaultMessage,
        values: args[0] as MessageValues | undefined,
      })
    return {
      locale,
      setLocale,
      format,
      // literals are business data (an org name, a tenant name): shown as is
      formatText: (text: UiText) =>
        text.kind === 'literal'
          ? text.value
          : format({ id: text.id, defaultMessage: text.defaultMessage }),
      formatError: (error: unknown, registry?: ErrorMessageMap) =>
        formatApiError(error, { format }, registry ? { ...errorMessages, ...registry } : errorMessages),
    }
    // `activated` is not read but ties the memo to the active catalog, so
    // every consumer re-renders after a locale switch
  }, [i18n, locale, setLocale, errorMessages, activated])

  if (activated === undefined) return <>{fallback}</>
  return <I18nContext value={runtime}>{children}</I18nContext>
}

// declarative rendering of a manifest-carried text reference
export function LocalizedText({ value }: { value: UiText }) {
  return <>{useI18n().formatText(value)}</>
}

const localeNames: Record<SupportedLocale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
}

// shell chrome owned by the runtime: switching activates the catalogs and
// re-renders, without refetching the manifest or any business data
export function LocaleSwitcher({ className }: { className?: string }) {
  const [locale, setLocale] = useLocale()
  return (
    <select
      className={className}
      aria-label="Language"
      value={locale}
      onChange={(event) => setLocale(event.target.value as SupportedLocale)}
    >
      {supportedLocales.map((candidate) => (
        <option key={candidate} value={candidate}>
          {localeNames[candidate]}
        </option>
      ))}
    </select>
  )
}
