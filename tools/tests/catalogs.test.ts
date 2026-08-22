import fs from 'node:fs'
import path from 'node:path'
import { manifestPath } from '../lib/manifest.ts'
import { describe, expect, it } from 'vitest'
import type { MessageCatalog, MessageDescriptor } from '@qualy/i18n-contract'
import { fallbackLocale, supportedLocales } from '@qualy/i18n-contract'
import { pathToFileURL } from 'node:url'
import { isPluginDescriptor, Plugin } from '@qualy/plugin-kit'
import { I18nCatalogs, UiSurfaceDeclarations } from '@qualy/plugin-ui-registry/plugin'
import { PermissionDeclarations } from '@qualy/rbac-contract/plugin'
import { readEntries } from '@qualy/assembly/host'
import { resolvePackageDir, resolvePluginModuleUrl } from '@qualy/assembly/host'

// every message a plugin declares must exist in each locale it ships, and a
// catalog must not carry keys nobody declares. Without this, a missing
// translation only shows up as english text in production.
//
// Declarations live in two places by design: the client catalog declares the
// text its components format, and the DESCRIPTOR declares the text the shell
// renders off the wire - navigation labels. Both count as declared here, or
// moving a label into the descriptor would read its translation as an
// orphan.

interface ClientModule {
  catalogs?: {
    namespace: string
    messages: readonly MessageDescriptor[]
    locales: Record<string, () => Promise<unknown>>
  }
  errorMessages?: Record<string, { message: MessageDescriptor }>
}

const declaredCatalogs = async () => {
  const found: { name: string; module: string }[] = []
  for (const entry of await readEntries({ manifestPath: manifestPath(), all: true })) {
    if (!entry.name.startsWith('@qualy/')) continue
    const descriptor = (
      (await import(resolvePluginModuleUrl(entry.name, manifestPath()))) as { default?: unknown }
    ).default
    if (!isPluginDescriptor(descriptor)) continue
    const declared = Plugin.contributionsOf(descriptor, I18nCatalogs)
    if (declared.length === 0) continue
    found.push({
      name: entry.name,
      module: path.resolve(
        resolvePackageDir(entry.name, manifestPath()),
        'src',
        declared[0]!.module,
      ),
    })
  }
  return found
}
const clientPlugins = await declaredCatalogs()

/** walks any declaration value and records every UiText message it carries */
const collectMessageIds = (value: unknown, into: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const entry of value) collectMessageIds(entry, into)
    return
  }
  if (value === null || typeof value !== 'object') return
  const text = value as { kind?: unknown; id?: unknown; defaultMessage?: unknown }
  if (
    text.kind === 'message' &&
    typeof text.id === 'string' &&
    typeof text.defaultMessage === 'string'
  ) {
    into.add(text.id)
    return
  }
  for (const entry of Object.values(value)) collectMessageIds(entry, into)
}

describe('plugin message catalogs', () => {
  it.each(clientPlugins)(
    '$name ships a complete catalog for every locale',
    async ({ name, module: file }) => {
      const module = (await import(pathToFileURL(file).href)) as ClientModule
      if (!module.catalogs) {
        // valid only for a plugin with no user-facing text at all
        expect(module.errorMessages).toBeUndefined()
        return
      }
      const declared = new Set(module.catalogs.messages.map((descriptor) => descriptor.id))
      const descriptor = (
        (await import(resolvePluginModuleUrl(name, manifestPath()))) as { default?: unknown }
      ).default
      if (isPluginDescriptor(descriptor)) {
        // every translatable message anywhere in the surface declarations:
        // page navigation labels, collection values (navigation groups, ...)
        for (const surfaces of Plugin.contributionsOf(descriptor, UiSurfaceDeclarations)) {
          collectMessageIds(surfaces, declared)
        }
        // and every permission this plugin declares: the role editor renders
        // those labels off the wire, so they are the plugin's copy as much as
        // a navigation entry is. Authored as plain strings they were invisible
        // here, and a whole catalog of them reached an English reader in
        // Chinese with no gate able to see it.
        for (const declaration of Plugin.contributionsOf(descriptor, PermissionDeclarations)) {
          collectMessageIds(declaration, declared)
        }
      }
      const namespace = module.catalogs.namespace
      // ids stay inside the plugin's own namespace, so merged catalogs cannot
      // shadow one another
      expect([...declared].filter((id) => !id.startsWith(`${namespace}/`))).toEqual([])
      for (const locale of supportedLocales) {
        const load = module.catalogs.locales[locale]
        // Only the fallback locale may be absent - its text is each
        // descriptor's defaultMessage. Skipping every absent locale meant a
        // plugin that shipped no translations at all was complete by
        // vacuity, which is the one case this gate exists to catch.
        if (!load) {
          expect({ locale, shipped: locale === fallbackLocale || declared.size === 0 }).toEqual({
            locale,
            shipped: true,
          })
          continue
        }
        const catalog = ((await load()) as { default: MessageCatalog }).default
        const translated = new Set(Object.keys(catalog))
        const missing = [...declared].filter((id) => !translated.has(id))
        const orphans = [...translated].filter((id) => !declared.has(id))
        expect({ locale, missing }).toEqual({ locale, missing: [] })
        expect({ locale, orphans }).toEqual({ locale, orphans: [] })
      }
    },
  )
  // A literal would pass the completeness check above by never being
  // collected at all, which is how the whole permission catalog crossed the
  // wire in one language for as long as it did. A permission label is
  // authored product copy, so it is always a message; `literal` is for
  // business data, which a permission name is not.
  it('names every permission with a message, never a literal', async () => {
    const authored: string[] = []
    for (const entry of await readEntries({ manifestPath: manifestPath(), all: true })) {
      const descriptor = (
        (await import(resolvePluginModuleUrl(entry.name, manifestPath()))) as { default?: unknown }
      ).default
      if (!isPluginDescriptor(descriptor)) continue
      for (const declaration of Plugin.contributionsOf(descriptor, PermissionDeclarations)) {
        for (const permission of declaration.permissions) {
          for (const [field, text] of [
            ['name', permission.name],
            ['description', permission.description],
          ] as const) {
            if (text === undefined) continue
            if (text.kind !== 'message') {
              authored.push(`${entry.name} ${permission.code} ${field}`)
            }
          }
        }
      }
    }
    expect(authored).toEqual([])
  })
})
