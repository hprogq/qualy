import { Layer } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'
import { compileSettingCatalog, type SettingDeclaration } from './index.ts'
import { SettingCatalog } from './effect.ts'

// The settings capability's face in the descriptor model. A setting catalog
// is prepare-phase data - ids, categories, defaults - and the settings
// plugin, which owns the table overrides land in, interprets the set.
//
// No `capability` key: a declaration leaves nothing behind for `qualy
// resolve` to own. The boot assembler is the gate - a plugin that declares
// settings in an assembly without the settings plugin is a hard failure at
// every boot, never a term nobody can override.

/** every plugin's setting declarations, in plugin order */
export const SettingDeclarations = ExtensionPoint.make<SettingDeclaration>(
  '@qualy/settings-contract/settings',
  { phase: 'prepare' },
)

export const Settings = {
  /** declares the categories this plugin opens and the settings it puts in them */
  definitions: (declaration: SettingDeclaration): PluginFeature =>
    Plugin.contribute(SettingDeclarations, declaration),

  /** the owner's interpretation: the finished catalog, before any layer builds */
  provider: Plugin.provideExtension(SettingDeclarations, {
    compile: (declarations) => Layer.succeed(SettingCatalog, compileSettingCatalog(declarations)),
  }),
}
