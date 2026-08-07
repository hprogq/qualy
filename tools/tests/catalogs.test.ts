import fs from 'node:fs'
import path from 'node:path'
import { manifestPath } from '../lib/manifest.ts'
import { describe, expect, it } from 'vitest'
import type { MessageCatalog, MessageDescriptor } from '@qualy/i18n-contract'
import { supportedLocales } from '@qualy/i18n-contract'
import { pathToFileURL } from 'node:url'
import { isPluginDescriptor, Plugin } from '@qualy/plugin-kit'
import { I18nCatalogs, UiSurfaceDeclarations } from '@qualy/plugin-ui-registry/plugin'
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
        for (const surfaces of Plugin.contributionsOf(descriptor, UiSurfaceDeclarations)) {
          for (const page of surfaces.pages ?? []) {
            const label = page.navigation?.label
            if (label && label.kind === 'message') declared.add(label.id)
          }
        }
      }
      const namespace = module.catalogs.namespace
      // ids stay inside the plugin's own namespace, so merged catalogs cannot
      // shadow one another
      expect([...declared].filter((id) => !id.startsWith(`${namespace}/`))).toEqual([])
      for (const locale of supportedLocales) {
        const load = module.catalogs.locales[locale]
        if (!load) continue
        const catalog = ((await load()) as { default: MessageCatalog }).default
        const translated = new Set(Object.keys(catalog))
        const missing = [...declared].filter((id) => !translated.has(id))
        const orphans = [...translated].filter((id) => !declared.has(id))
        expect({ locale, missing }).toEqual({ locale, missing: [] })
        expect({ locale, orphans }).toEqual({ locale, orphans: [] })
      }
    },
  )
})
