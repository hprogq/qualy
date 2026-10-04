import { Context, Effect, Layer } from 'effect'
import { sql } from 'kysely'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '@qualy/api-kit/plugin'
import { CurrentUser } from '@qualy/auth-contract/session'
import { Rbac, type AccessDenied } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import { Audit } from '@qualy/audit-contract/effect'
import {
  transaction,
  withDatabase,
  type Orm,
  type QueryFailed,
} from '@qualy/plugin-database/server'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { render, renderTexts, type Text } from '@qualy/text'
import { requestLocale } from '@qualy/api-kit/locale'
import { SettingCatalog, TenantSettings } from '@qualy/settings-contract/effect'
import {
  checkDefaults,
  effectiveText,
  normalizeOverride,
  type LocalizedText,
  type LocalizedTextOverride,
  type RegisteredSetting,
  type TermDefinition,
  type TermRef,
} from '@qualy/settings-contract'
import { settingsApiGroup } from '../api.ts'
import { TermOverrideUpdated } from '../actions.ts'
import { db, lockTenant } from './db.ts'
import {
  SettingNotFound,
  SettingValueInvalid,
  SettingVersionConflict,
  settingConstraints,
} from './errors.ts'

// The store: overrides read and written per tenant, resolved against the
// catalog the assembly compiled. Reads join the two; writes normalize
// against the definition, hold the row to the version the writer read, and
// record the change in the same transaction.

export const MANAGE = 'settings.terminology.manage'

/** one term as the terminology screen edits it */
export interface TermView {
  readonly id: string
  readonly categoryId: string
  readonly label: Text
  readonly description: Text | null
  readonly order: number
  readonly maxLength: number
  readonly defaults: Readonly<Record<string, string>>
  readonly override: Readonly<Record<string, string>>
  readonly version: number
}

export interface TerminologyView {
  readonly categories: readonly {
    readonly id: string
    readonly label: Text
    readonly order: number
  }[]
  readonly terms: readonly TermView[]
}

export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    readonly readTerminology: (tenantId: string) => Effect.Effect<TerminologyView>
    readonly writeTerm: (
      tenantId: string,
      settingId: string,
      input: { readonly version: number; readonly override: Readonly<Record<string, string>> },
      as: Principal,
    ) => Effect.Effect<
      { readonly id: string; readonly override: LocalizedTextOverride; readonly version: number },
      SettingNotFound | SettingVersionConflict | SettingValueInvalid | AccessDenied
    >
    readonly resolveTerm: (
      tenantId: string,
      term: TermRef,
      locale: SupportedLocale,
    ) => Effect.Effect<string>
    /**
     * Every term's word in one locale, by id: the tenant's where it chose
     * one, the product's otherwise. Without a tenant - a visitor nobody has
     * signed in as - the product's words alone, which are nobody's secret.
     */
    readonly termsFor: (
      tenantId: string | undefined,
      locale: SupportedLocale,
    ) => Effect.Effect<Readonly<Record<string, string>>>
  }
>()('@qualy/plugin-settings/SettingsStore') {}

// stringified before the cast so an encoded object cannot be mistaken for a
// postgres composite on the wire
const jsonb = (value: unknown) => sql<Record<string, unknown>>`${JSON.stringify(value)}::jsonb`

const storedValues = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('TenantSettingValue')
      .select(['settingId', 'value', 'version'])
      .where('tenantId', '=', tenantId)
      .execute(),
  )

const storedValue = (tenantId: string, settingId: string) =>
  db.query((k) =>
    k
      .selectFrom('TenantSettingValue')
      .select(['value', 'version'])
      .where('tenantId', '=', tenantId)
      .where('settingId', '=', settingId)
      .executeTakeFirst(),
  )

/** the stored JSON read as words by locale; anything else in it is ignored */
const wordsOf = (value: unknown): Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const words: Record<string, string> = {}
  for (const [key, word] of Object.entries(value as Record<string, unknown>)) {
    if (typeof word === 'string') words[key] = word
  }
  return words
}

const make = Effect.gen(function* () {
  const catalog = yield* SettingCatalog
  const withDb = yield* withDatabase
  const rbac = yield* Rbac
  const audit = yield* Audit
  const terms = catalog.settings.filter(
    (setting): setting is RegisteredSetting & TermDefinition => setting.purpose === 'term',
  )
  const termById = new Map(terms.map((term) => [term.id, term]))
  // the product's words for every term, said once in every locale and
  // checked: a default that says nothing in one language refuses the boot
  const defaults = new Map<string, LocalizedText>(
    terms.map((term) => [
      term.id,
      checkDefaults(term, (locale) => render(term.default, { locale })),
    ]),
  )
  const defaultsOf = (term: { readonly id: string }) => defaults.get(term.id)!

  const readTerminology = Effect.fn('Settings.readTerminology')(function* (tenantId: string) {
    const rows = yield* withDb(storedValues(tenantId)).pipe(Effect.orDie)
    const stored = new Map(rows.map((row) => [row.settingId, row]))
    const named = new Set(terms.map((term) => term.categoryId))
    return {
      categories: catalog.categories
        .filter((category) => named.has(category.id))
        .map((category) => ({ id: category.id, label: category.label, order: category.order })),
      terms: terms.map((term) => {
        const row = stored.get(term.id)
        return {
          id: term.id,
          categoryId: term.categoryId,
          label: term.label,
          description: term.description ?? null,
          order: term.order,
          maxLength: term.maxLength,
          defaults: defaultsOf(term),
          override: row === undefined ? {} : wordsOf(row.value),
          version: row?.version ?? 0,
        }
      }),
    } satisfies TerminologyView
  })

  /** what a term is called after a write: the first override that says anything, else its default */
  const termWord = (
    termDefaults: LocalizedText,
    override: Readonly<Record<string, string | undefined>>,
  ): string => {
    const spoken = Object.values(override).find((word) => (word ?? '') !== '')
    return spoken ?? Object.values(termDefaults).find((word) => word !== '') ?? ''
  }

  const writeTerm: SettingsStore['Service']['writeTerm'] = Effect.fn('Settings.writeTerm')(
    function* (tenantId, settingId, input, as) {
      yield* rbac.require(as, MANAGE)
      const term = termById.get(settingId)
      if (term === undefined) return yield* new SettingNotFound()
      const normalized = normalizeOverride(
        { maxLength: term.maxLength, defaults: defaultsOf(term) },
        input.override,
      )
      if (!normalized.ok) {
        return yield* new SettingValueInvalid({
          reason: normalized.reason,
          locale: normalized.locale,
        })
      }
      const next = normalized.value
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            yield* lockTenant(tenantId)
            yield* rbac.require(as, MANAGE)
            // the row moves only from the version the writer read: a second
            // administrator saving over the first is told, not overwritten
            const version =
              input.version === 0
                ? yield* db
                    .query((k) =>
                      k
                        .insertInto('TenantSettingValue')
                        .values({ tenantId, settingId, value: jsonb(next) })
                        .returning('version')
                        .executeTakeFirstOrThrow(),
                    )
                    .pipe(translateConstraints(settingConstraints))
                : yield* db.query((k) =>
                    k
                      .updateTable('TenantSettingValue')
                      .set({
                        value: jsonb(next),
                        version: input.version + 1,
                        updatedAt: new Date(),
                      })
                      .where('tenantId', '=', tenantId)
                      .where('settingId', '=', settingId)
                      .where('version', '=', input.version)
                      .returning('version')
                      .executeTakeFirst(),
                  )
            if (version === undefined) return yield* new SettingVersionConflict()
            yield* audit.record(TermOverrideUpdated, {
              tenantId,
              actor: { kind: 'user', userId: as.userId },
              // the word the tenant now uses, or the default it went back
              // to: "auth/business-number" is this plugin's key for the term,
              // and told a reader of the trail nothing
              target: { id: settingId, label: termWord(defaultsOf(term), next) },
              details: {
                locales: Object.keys(next) as ('zh-CN' | 'en-US')[],
              },
            })
            return { id: settingId, override: next, version: version.version }
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error: QueryFailed) => Effect.die(error)))
    },
  )

  const resolveTerm = Effect.fn('Settings.resolveTerm')(function* (
    tenantId: string,
    term: TermRef,
    locale: SupportedLocale,
  ) {
    if (!termById.has(term.id)) {
      return yield* Effect.die(new Error(`no plugin of this assembly declares the term ${term.id}`))
    }
    const row = yield* withDb(storedValue(tenantId, term.id)).pipe(Effect.orDie)
    return effectiveText(
      defaultsOf(term),
      row === undefined ? undefined : wordsOf(row.value),
      locale,
    )
  })

  const termsFor = Effect.fn('Settings.termsFor')(function* (
    tenantId: string | undefined,
    locale: SupportedLocale,
  ) {
    const stored =
      tenantId === undefined
        ? new Map<string, Record<string, string>>()
        : new Map(
            (yield* withDb(storedValues(tenantId)).pipe(Effect.orDie)).map((row) => [
              row.settingId,
              wordsOf(row.value),
            ]),
          )
    return Object.fromEntries(
      terms.map((term) => [term.id, effectiveText(defaultsOf(term), stored.get(term.id), locale)]),
    )
  })

  return SettingsStore.of({ readTerminology, writeTerm, resolveTerm, termsFor })
})

export const storeLayer: Layer.Layer<SettingsStore, never, Orm | SettingCatalog | Rbac | Audit> =
  Layer.effect(SettingsStore, make)

/** the store, and the contract face other plugins resolve a term through */
export const serviceLayer: Layer.Layer<
  SettingsStore | TenantSettings,
  never,
  Orm | SettingCatalog | Rbac | Audit
> = Layer.effect(
  TenantSettings,
  Effect.map(SettingsStore, (store) => TenantSettings.of({ resolveTerm: store.resolveTerm })),
).pipe(Layer.provideMerge(storeLayer))

// --- api ---

const local = Api.local(settingsApiGroup)

export const settingsApiHandlers = HttpApiBuilder.group(local, 'settings', (handlers) =>
  handlers
    .handle(
      'getTerminology',
      Effect.fn('settings.getTerminology.handler')(function* () {
        const store = yield* SettingsStore
        const principal = yield* CurrentUser
        return renderTexts(yield* store.readTerminology(principal.tenantId), {
          locale: yield* requestLocale,
        })
      }),
    )
    .handle(
      'putTerm',
      Effect.fn('settings.putTerm.handler')(function* ({ params, payload }) {
        const store = yield* SettingsStore
        const principal = yield* CurrentUser
        return yield* store.writeTerm(
          principal.tenantId,
          `${params.namespace}/${params.name}`,
          { version: payload.version, override: payload.override },
          principal,
        )
      }),
    ),
)
