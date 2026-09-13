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
  /** the watchdog's line when the page's own files failed to load, up to the link */
  readonly assetFailedLead: string
  /** a newer release is on the server; the page goes on working */
  readonly updateAvailableTitle: string
  readonly updateAvailableHint: string
  readonly later: string
  readonly reloadNow: string
  /** a chunk this release needs is gone because a newer release replaced it */
  readonly releaseSkewTitle: string
  readonly releaseSkewHint: string
  /** a chunk failed to load and the server has not changed */
  readonly assetFailedTitle: string
  readonly assetFailedHint: string
  /** the server no longer speaks this page's protocol */
  readonly clientProtocolTitle: string
  readonly clientProtocolHint: string
  /** the one way out of any of the three */
  readonly reloadPage: string
}

export const bootstrapMessages = {
  'zh-CN': {
    loading: '加载中',
    stillLoading: '加载时间较长，请稍候…',
    retry: '重试',
    reloadLead: '加载时间较长，',
    reload: '刷新页面',
    assetFailedLead: '页面加载失败，',
    updateAvailableTitle: 'Qualy 已更新',
    updateAvailableHint: '刷新后即可使用最新版本。',
    later: '稍后',
    reloadNow: '刷新',
    releaseSkewTitle: '需要刷新页面',
    releaseSkewHint: '页面需要刷新后才能继续使用。',
    assetFailedTitle: '页面加载失败',
    assetFailedHint: '请检查网络后刷新页面。',
    clientProtocolTitle: '需要刷新页面',
    clientProtocolHint: '页面需要刷新后才能继续使用。',
    reloadPage: '刷新页面',
  },
  'en-US': {
    loading: 'Loading',
    stillLoading: 'Taking longer than expected…',
    retry: 'Retry',
    reloadLead: 'Taking longer than expected. ',
    reload: 'Reload',
    assetFailedLead: 'The page could not be loaded. ',
    updateAvailableTitle: 'Qualy has been updated',
    updateAvailableHint: 'Reload to use the latest version.',
    later: 'Later',
    reloadNow: 'Reload',
    releaseSkewTitle: 'Reload needed',
    releaseSkewHint: 'Reload the page to continue.',
    assetFailedTitle: 'The page could not be loaded',
    assetFailedHint: 'Check your connection and reload the page.',
    clientProtocolTitle: 'Reload needed',
    clientProtocolHint: 'Reload the page to continue.',
    reloadPage: 'Reload the page',
  },
} as const satisfies Record<SupportedLocale, BootstrapMessages>
