import type { SupportedLocale, UiText } from '@qualy/i18n-contract'
import { supportedLocales } from '@qualy/i18n-contract'

// Tenant settings, as declarations.
//
// A plugin says which of its product-defined settings a tenant may override,
// what each one is called, how it is grouped and what its default is; the
// settings plugin stores overrides and resolves the effective value. What is
// deliberately NOT here: a way for a tenant to invent settings, a way to
// override arbitrary i18n copy, or a second schema language - the database
// keeps a JSON value per setting and the definition here is what decides
// what that value may hold.
//
// One kind exists today, `localized-text`, and one purpose, `term`: a
// business word (the tenant's name for a person's identifier) that every
// screen shows through the same door. The shape leaves room for image or
// boolean kinds later without moving a row.

/** a text in every locale the product speaks; the plugin's default for a setting */
export type LocalizedText = Readonly<Record<SupportedLocale, string>>

/** the tenant's words, where it chose any: locales left out follow the default */
export type LocalizedTextOverride = Readonly<Partial<Record<SupportedLocale, string>>>

/** a grouping a settings screen shows, declared by the plugin whose settings sit in it */
export interface SettingCategoryDefinition {
  readonly id: string
  readonly label: UiText
  readonly order: number
}

export interface LocalizedTextSettingDefinition {
  readonly kind: 'localized-text'
  /** `<namespace>/<name>`, the namespace being the declaring plugin's short name */
  readonly id: string
  readonly categoryId: string
  readonly label: UiText
  readonly description?: UiText
  readonly order: number
  readonly defaults: LocalizedText
  readonly maxLength: number
  /** who may read the effective value: everyone signed in, or an anonymous visitor too */
  readonly exposure: 'authenticated' | 'public'
  /** what the value is for; `term` is a business word shown through useTerm / resolveTerm */
  readonly purpose: 'term'
}

export type TenantSettingDefinition = LocalizedTextSettingDefinition

/** a localized-text setting whose purpose is a term */
export type TermDefinition = LocalizedTextSettingDefinition & { readonly purpose: 'term' }

/** `<namespace>/<name>`, both kebab-case; one slash, so the api can name it in two segments */
export const SETTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/

/** the room a term has by default: a word or two, never a sentence */
export const TERM_MAX_LENGTH = 64

export const defineSettingCategory = (
  definition: SettingCategoryDefinition,
): SettingCategoryDefinition => definition

/** a term: a localized-text setting whose whole job is to be a word the tenant chooses */
export const defineTerm = (definition: {
  readonly id: string
  readonly categoryId: string
  readonly label: UiText
  readonly description?: UiText
  readonly order: number
  readonly defaults: LocalizedText
  readonly maxLength?: number
  readonly exposure?: 'authenticated' | 'public'
}): TermDefinition => ({
  kind: 'localized-text',
  purpose: 'term',
  maxLength: definition.maxLength ?? TERM_MAX_LENGTH,
  exposure: definition.exposure ?? 'authenticated',
  id: definition.id,
  categoryId: definition.categoryId,
  label: definition.label,
  ...(definition.description === undefined ? {} : { description: definition.description }),
  order: definition.order,
  defaults: definition.defaults,
})

/** one plugin's declaration: the categories it opens and the settings it puts in them */
export interface SettingDeclaration {
  readonly categories?: readonly SettingCategoryDefinition[]
  readonly settings?: readonly TenantSettingDefinition[]
}

export interface RegisteredSettingCategory extends SettingCategoryDefinition {
  readonly plugin: string
}

export type RegisteredSetting = TenantSettingDefinition & { readonly plugin: string }

/** every declaration of the assembly, checked and flattened */
export interface SettingCatalogValue {
  readonly categories: readonly RegisteredSettingCategory[]
  readonly settings: readonly RegisteredSetting[]
}

const KINDS: readonly TenantSettingDefinition['kind'][] = ['localized-text']

/**
 * The declarations flattened with their plugins stamped, anything ambiguous
 * refused.
 *
 * A setting claimed twice has no owner and a category nobody declared has no
 * place on a screen, so both fail the assembly naming the plugins - never
 * "whichever loaded last". Defaults are checked here too: a term with no word
 * in one of the product's locales would show an empty label to everyone who
 * reads in it, and that is a declaration error, not a runtime state.
 */
export const compileSettingCatalog = (
  declarations: readonly { readonly pluginId: string; readonly value: SettingDeclaration }[],
): SettingCatalogValue => {
  const categoryOwners = new Map<string, string>()
  const settingOwners = new Map<string, string>()
  const categories: RegisteredSettingCategory[] = []
  const settings: RegisteredSetting[] = []
  for (const { pluginId, value } of declarations) {
    for (const category of value.categories ?? []) {
      if (!SETTING_ID.test(category.id)) {
        throw new Error(`setting category "${category.id}" of ${pluginId} is malformed`)
      }
      const previous = categoryOwners.get(category.id)
      if (previous !== undefined) {
        throw new Error(
          `setting category ${category.id} is declared by both ${previous} and ${pluginId}`,
        )
      }
      if (!Number.isInteger(category.order) || category.order < 0) {
        throw new Error(`setting category ${category.id} of ${pluginId} needs an order >= 0`)
      }
      categoryOwners.set(category.id, pluginId)
      categories.push({ ...category, plugin: pluginId })
    }
  }
  for (const { pluginId, value } of declarations) {
    for (const setting of value.settings ?? []) {
      if (!SETTING_ID.test(setting.id)) {
        throw new Error(`setting "${setting.id}" of ${pluginId} is malformed`)
      }
      const previous = settingOwners.get(setting.id)
      if (previous !== undefined) {
        throw new Error(`setting ${setting.id} is declared by both ${previous} and ${pluginId}`)
      }
      if (!KINDS.includes(setting.kind)) {
        throw new Error(`setting ${setting.id} of ${pluginId} has unsupported kind ${setting.kind}`)
      }
      if (!categoryOwners.has(setting.categoryId)) {
        throw new Error(
          `setting ${setting.id} of ${pluginId} names category ${setting.categoryId}, which nobody declares`,
        )
      }
      if (!Number.isInteger(setting.order) || setting.order < 0) {
        throw new Error(`setting ${setting.id} of ${pluginId} needs an order >= 0`)
      }
      if (!Number.isInteger(setting.maxLength) || setting.maxLength < 1) {
        throw new Error(`setting ${setting.id} of ${pluginId} needs a maxLength >= 1`)
      }
      for (const locale of supportedLocales) {
        const word = setting.defaults[locale]
        if (typeof word !== 'string' || word.trim() === '') {
          throw new Error(`setting ${setting.id} of ${pluginId} has no default for ${locale}`)
        }
        if (word.length > setting.maxLength) {
          throw new Error(
            `setting ${setting.id} of ${pluginId}: the ${locale} default is longer than ${setting.maxLength}`,
          )
        }
      }
      settingOwners.set(setting.id, pluginId)
      settings.push({ ...setting, plugin: pluginId })
    }
  }
  return { categories, settings }
}

/** the text a reader sees: the tenant's word when it chose one, the plugin's default otherwise */
export const effectiveText = (
  definition: LocalizedTextSettingDefinition,
  override: LocalizedTextOverride | undefined,
  locale: SupportedLocale,
): string => {
  const chosen = override?.[locale]
  return chosen !== undefined && chosen !== '' ? chosen : definition.defaults[locale]
}

export type OverrideProblem =
  | { readonly reason: 'unknown-locale'; readonly locale: string }
  | { readonly reason: 'too-long'; readonly locale: string }

/**
 * An override as it is stored: trimmed, empties dropped, and a word that
 * merely repeats the default dropped too.
 *
 * The database keeps the delta and nothing else, so a default that changes
 * in a later release reaches every tenant that never chose otherwise.
 */
export const normalizeOverride = (
  definition: LocalizedTextSettingDefinition,
  override: Readonly<Record<string, string>>,
):
  | { readonly ok: true; readonly value: LocalizedTextOverride }
  | ({ readonly ok: false } & OverrideProblem) => {
  const value: Partial<Record<SupportedLocale, string>> = {}
  for (const [key, raw] of Object.entries(override)) {
    if (!(supportedLocales as readonly string[]).includes(key)) {
      return { ok: false, reason: 'unknown-locale', locale: key }
    }
    const locale = key as SupportedLocale
    const word = raw.trim()
    if (word === '' || word === definition.defaults[locale]) continue
    if (word.length > definition.maxLength) return { ok: false, reason: 'too-long', locale }
    value[locale] = word
  }
  return { ok: true, value }
}
