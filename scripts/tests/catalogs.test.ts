import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MessageCatalog, MessageDescriptor } from '@qualy/i18n-contract'
import { supportedLocales } from '@qualy/i18n-contract'
import { isPluginDescriptor, Plugin } from '@qualy/plugin-kit'
import { UiSurfaceDeclarations } from '@qualy/plugin-ui-registry/plugin'
import { readEntries } from '../lib/read-entries.ts'
import { resolvePackageDir, resolvePluginModuleUrl } from '../lib/packages.ts'

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

const clientPlugins = (await readEntries({ all: true })).flatMap((entry) => {
  if (!entry.name.startsWith('@qualy/')) return []
  const pkg = JSON.parse(
    fs.readFileSync(path.join(resolvePackageDir(entry.name), 'package.json'), 'utf8'),
  ) as { exports?: Record<string, unknown> }
  return pkg.exports?.['./client'] ? [entry.name] : []
})

describe('plugin message catalogs', () => {
  it.each(clientPlugins)('%s ships a complete catalog for every locale', async (name) => {
    const module = (await import(resolvePluginModuleUrl(`${name}/client`))) as ClientModule
    if (!module.catalogs) {
      // valid only for a plugin with no user-facing text at all
      expect(module.errorMessages).toBeUndefined()
      return
    }
    const declared = new Set(module.catalogs.messages.map((descriptor) => descriptor.id))
    const descriptor = ((await import(resolvePluginModuleUrl(name))) as { default?: unknown })
      .default
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
  })
})
