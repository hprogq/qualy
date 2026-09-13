import type { SupportedLocale } from '@qualy/i18n-contract'

// The few words the application needs before it has a language.
//
// Two places speak before the catalogs are here, and neither can wait for
// them: the cold-start screen, which stands above the localization runtime
// by design, and the watchdog in index.html, which runs when no script of
// the application ever did. Both read this table, in the locale the shell's
// boot script resolved and marked on the root before the first frame -
// through the same preference chain the runtime follows, so the language
// does not change hands when the catalogs arrive. The build writes the
// watchdog's two lines into index.html from here; nothing is typed there.
//
// Three of these are also messages of the common catalog, said again here
// rather than imported from it: the catalog for a locale is a chunk loaded
// on demand, and the whole of it is not worth carrying in the boot graph
// for three lines. A test holds the two in step.

export interface BootstrapMessages {
  /** what the status region says while the screen is up */
  readonly loading: string
  /** the line under the wordmark once the wait has run long */
  readonly stillLoading: string
  /** the button once the wait has run too long */
  readonly retry: string
  /** the watchdog's line, up to the link */
  readonly reloadLead: string
  /** the watchdog's link */
  readonly reload: string
}

export const bootstrapMessages = {
  'zh-CN': {
    loading: '加载中',
    stillLoading: '加载时间较长，请稍候…',
    retry: '重试',
    reloadLead: '加载时间较长，',
    reload: '刷新页面',
  },
  'en-US': {
    loading: 'Loading',
    stillLoading: 'Taking longer than expected…',
    retry: 'Retry',
    reloadLead: 'Taking longer than expected. ',
    reload: 'Reload',
  },
} as const satisfies Record<SupportedLocale, BootstrapMessages>
