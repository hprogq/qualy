import { Layer } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'
import type { AuditAction } from './action.ts'
import { AuditActionCatalog, type RegisteredAuditAction } from './effect.ts'

// The audit capability's face in the descriptor model. An action catalog is
// prepare-phase data - codes, versions, detail schemas - and the audit
// plugin, which owns the table events land in, interprets the set.
//
// No `capability` key on the point: unlike permissions, actions leave no
// per-assembly state behind for `qualy resolve` to own - the rows they
// explain carry their own code and version. The boot assembler is the gate:
// a plugin that declares actions in an assembly without the audit plugin is
// a hard failure at every dev boot and in CI, which is the mandatory-base
// rule the design asks for.

export interface AuditActionDeclaration {
  /** the plugin's short name, what an audit screen shows as the definer */
  readonly owner: string
  readonly actions: readonly AuditAction[]
}

/** every plugin's audit action declarations, in plugin order */
export const AuditActionDeclarations = ExtensionPoint.make<AuditActionDeclaration>(
  '@qualy/audit-contract/actions',
  { phase: 'prepare' },
)

const CODE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/

/**
 * The declarations flattened with their owners stamped, duplicates refused.
 *
 * A code claimed twice has no owner - the stored rows would not say which
 * schema explains them - and a malformed code or version is refused here, at
 * assembly, rather than discovered as unreadable history. Exported for
 * harnesses, which build catalogs from the same declarations production
 * compiles.
 */
export const compileActionCatalog = (
  declarations: readonly AuditActionDeclaration[],
): RegisteredAuditAction[] => {
  const owners = new Map<string, string>()
  const catalog: RegisteredAuditAction[] = []
  for (const declaration of declarations) {
    for (const action of declaration.actions) {
      if (!CODE.test(action.code)) {
        throw new Error(`audit action code "${action.code}" of ${declaration.owner} is malformed`)
      }
      if (!Number.isInteger(action.version) || action.version < 1) {
        throw new Error(`audit action ${action.code} of ${declaration.owner} needs a version >= 1`)
      }
      const previous = owners.get(action.code)
      if (previous) {
        throw new Error(
          `audit action ${action.code} is declared by both ${previous} and ${declaration.owner}`,
        )
      }
      owners.set(action.code, declaration.owner)
      catalog.push({ plugin: declaration.owner, action })
    }
  }
  return catalog
}

export const Audit = {
  /** declares the audit actions this plugin may record */
  actions: (owner: string, actions: readonly AuditAction[]): PluginFeature =>
    Plugin.contribute(AuditActionDeclarations, { owner, actions }),

  /** the owner's interpretation: the finished catalog, before any layer builds */
  provider: Plugin.provideExtension(AuditActionDeclarations, {
    compile: (declarations) =>
      Layer.succeed(
        AuditActionCatalog,
        compileActionCatalog(declarations.map((declaration) => declaration.value)),
      ),
  }),
}
