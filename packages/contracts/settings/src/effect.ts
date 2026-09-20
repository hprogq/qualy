import { Context, type Effect } from 'effect'
import type { SupportedLocale } from '@qualy/i18n-contract'
import type { SettingCatalogValue, TermDefinition } from './index.ts'

// The Effect side of this contract, behind its own subpath like every other
// contract's: the root reaches the browser, and `effect` has no business in
// that bundle.

/**
 * Every setting this assembly knows, complete before any layer builds.
 *
 * A prepare-phase value compiled from every plugin's declaration, so the
 * settings plugin - and whatever resolves a term above it - is handed a
 * finished catalog and is downstream of nobody.
 */
export class SettingCatalog extends Context.Service<SettingCatalog, SettingCatalogValue>()(
  '@qualy/settings-contract/SettingCatalog',
) {}

export interface TenantSettingsShape {
  /**
   * The word a tenant uses for a term, in one locale.
   *
   * For the places that are not a screen: a workbook header, an export, a
   * generated document. The browser reads the same answer through its own
   * hook. Never fails: a term with no override is its default.
   */
  readonly resolveTerm: (
    tenantId: string,
    term: TermDefinition,
    locale: SupportedLocale,
  ) => Effect.Effect<string>
}

export class TenantSettings extends Context.Service<TenantSettings, TenantSettingsShape>()(
  '@qualy/settings-contract/TenantSettings',
) {}
