import { supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import * as m from '#messages'

// The few words the application needs before it has a language.
//
// Two places speak before the application has marked a language anywhere,
// and neither can wait: the cold-start screen, which stands above everything
// else by design, and the watchdog in index.html, which runs when no script
// of the application ever did. Both read this table in the locale the
// shell's boot script resolved, through the same preference chain the
// application follows, so the language does not change hands as it arrives.
// The build writes the watchdog's lines into index.html from here; nothing
// is typed there.
//
// A third place speaks with no application at all: the edge's maintenance
// page (deploy/demo/maintenance.html), served while no release answers. It
// is a file the proxy hands out as it stands, so its lines are typed into
// it, and tools/tests/maintenance-page.test.ts holds them to this table.
//
// Every line is one of this package's messages, said in both languages here
// because nothing has chosen one yet; the words a screen says again once
// the application is up are the same messages, so the two cannot drift.

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
  /** another page of this browser chose a language; this one keeps its own until reloaded */
  readonly localeChangedTitle: string
  readonly localeChangedHint: string
  /** the edge's own page while no release answers (deploy/demo/maintenance.html) */
  readonly maintenanceTitle: string
  readonly maintenanceHint: string
}

const inLocale = (locale: SupportedLocale): BootstrapMessages => {
  const at = { locale }
  return {
    loading: m.state_loading({}, at),
    stillLoading: m.state_stillLoading({}, at),
    retry: m.action_retry({}, at),
    reloadLead: m.boot_reloadLead({}, at),
    reload: m.boot_reload({}, at),
    assetFailedLead: m.boot_assetFailedLead({}, at),
    updateAvailableTitle: m.release_updateAvailableTitle({}, at),
    updateAvailableHint: m.release_updateAvailableHint({}, at),
    later: m.action_later({}, at),
    reloadNow: m.action_reload({}, at),
    releaseSkewTitle: m.release_skewTitle({}, at),
    releaseSkewHint: m.release_skewHint({}, at),
    assetFailedTitle: m.release_assetFailedTitle({}, at),
    assetFailedHint: m.release_assetFailedHint({}, at),
    clientProtocolTitle: m.release_clientProtocolTitle({}, at),
    clientProtocolHint: m.release_clientProtocolHint({}, at),
    reloadPage: m.action_reloadPage({}, at),
    localeChangedTitle: m.release_localeChangedTitle({}, at),
    localeChangedHint: m.release_localeChangedHint({}, at),
    maintenanceTitle: m.boot_maintenanceTitle({}, at),
    maintenanceHint: m.boot_maintenanceHint({}, at),
  }
}

export const bootstrapMessages = Object.fromEntries(
  supportedLocales.map((locale) => [locale, inLocale(locale)]),
) as Readonly<Record<SupportedLocale, BootstrapMessages>>
