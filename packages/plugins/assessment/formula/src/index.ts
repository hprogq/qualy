import { Plugin } from '@qualy/plugin-kit'
import { Db } from '@qualy/plugin-database/plugin'
import { Api } from '@qualy/api-kit/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Scoring } from '@qualy/plugin-assessment/plugin'
import { calculatorEditorSlot, calculatorSummarySlot } from '@qualy/plugin-assessment/surfaces'
import { APP_SHELL, PUBLIC, navigationGroups, permissionOf } from '@qualy/ui-contract'
import { message } from '@qualy/i18n-contract'
import { permissions } from './permissions.ts'
import { formulaActions } from './actions.ts'
import { formulaApiGroup } from './api.ts'
import { formulaApiHandlers, layer as libraryLayer } from './server/index.ts'
import { runtimeStoreLayer } from './server/runtime-store.ts'
import { bindingCatalogLayer } from './server/binding-catalog.ts'
import { templateLibraryLayer } from './server/template-library.ts'
import { formulaAuthoringLayer } from './server/authoring.ts'
import { formulaLanguageLayer } from './server/language.ts'
import { formulaLspQuotaLayer } from './server/lsp-bridge.ts'
import { config } from './server/config.ts'
import { formulaAuthoringSurfaceLayer } from './server/authoring-surface.ts'
import { formula1 } from './scoring/formula-calculator.ts'
import { formulaAuthoringPolicy } from './scoring/authoring-policy.ts'
import { Layer } from 'effect'
import { compositeForeignKeys, entities } from './db/entities.ts'

// The formula library: typed scoring functions written by administrators,
// compiled and frozen into immutable versions. This plugin owns authoring
// and publication; executing a version inside scoring is the calculator's
// business and arrives with it.

const plugin = Plugin.define(
  '@qualy/plugin-assessment-formula',
  {
    dependsOn: [
      '@qualy/plugin-assessment',
      '@qualy/plugin-audit',
      '@qualy/plugin-auth',
      '@qualy/plugin-database',
      '@qualy/plugin-org',
      '@qualy/plugin-rbac',
      '@qualy/plugin-sandbox',
      '@qualy/plugin-ui-registry',
    ],
    // the writer switch, from the manifest: see ./server/config.ts
    config,
  },
  Db.entities(entities, {
    compositeForeignKeys,
    // org owns the tenant these tables hang on and the units a share scope
    // points at; auth owns the people a template names as its author
    dependsOn: ['@qualy/plugin-org', '@qualy/plugin-auth'],
  }),
  // A heading of its own inside the library: the library is one application,
  // and what is filed in it is not all one kind of thing.
  Ui.surfaces({
    collections: [
      {
        collection: navigationGroups,
        id: 'assessment-formula/library',
        value: {
          id: 'assessment-formula/library',
          label: message('assessment-formula/nav-group/library', 'Scoring formulas'),
          order: 10,
          parent: 'library/main',
        },
        visibility: PUBLIC,
      },
    ],
  }),
  Access.permissions('assessment-formula', permissions),
  // the shipped scoring driver: 7.3's decision, made here and nowhere else
  ...Scoring.calculator(formula1),
  Scoring.authoringPolicy(formulaAuthoringPolicy),
  Audit.actions('assessment-formula', formulaActions),
  Plugin.layer(
    Layer.mergeAll(
      libraryLayer.pipe(Layer.provide(formulaAuthoringLayer())),
      formulaLanguageLayer(),
      formulaLspQuotaLayer,
      // the runtime half: resolution consults no authoring state. The
      // library leans on it for one thing only - trying a published
      // version runs the artifact this store verifies - and 7.3's
      // calculator bind is where the rest gets consumed
      runtimeStoreLayer,
      bindingCatalogLayer,
      // the audience half: what a published version has been offered to,
      // which the private library above deliberately knows nothing about
      templateLibraryLayer,
      // the chooser's option, offered only while the manifest opens the
      // writer; the editor seat below stays declared whatever it says
      formulaAuthoringSurfaceLayer,
    ),
  ),
  Api.group(formulaApiGroup, formulaApiHandlers),
  Ui.page({
    id: 'assessment-formula/list',
    path: '/library/formulas',
    component: Ui.react('./client/FormulaListPage'),
    layout: APP_SHELL,
    title: message('assessment-formula/list/title', 'Scoring formulas'),
    visibility: permissionOf('assessment.formula.author'),
    navigation: {
      label: message('assessment-formula/navigation/formulas', 'Scoring formulas'),
      icon: 'sigma',
      order: 20,
      group: 'assessment-formula/library',
    },
  }),
  Ui.page({
    id: 'assessment-formula/templates',
    path: '/library/formula-templates',
    component: Ui.react('./client/FormulaTemplatesPage'),
    layout: APP_SHELL,
    title: message('assessment-formula/templates/title', 'Formula templates'),
    // the same capability the library itself takes: the only thing to do
    // with a template is start a formula of your own from it
    visibility: permissionOf('assessment.formula.author'),
    navigation: {
      label: message('assessment-formula/navigation/templates', 'Formula templates'),
      icon: 'file-text',
      order: 30,
      group: 'assessment-formula/library',
    },
  }),
  Ui.page({
    // reached from the library rather than from the navigation, so it
    // declares no entry of its own
    id: 'assessment-formula/template',
    path: '/library/formula-templates/:versionId',
    component: Ui.react('./client/FormulaTemplatePage'),
    layout: APP_SHELL,
    title: message('assessment-formula/templates/title', 'Formula templates'),
    visibility: permissionOf('assessment.formula.author'),
  }),
  Ui.page({
    id: 'assessment-formula/editor',
    path: '/library/formulas/:functionId',
    component: Ui.react('./client/FormulaEditorPage'),
    layout: APP_SHELL,
    title: message('assessment-formula/list/title', 'Scoring formulas'),
    visibility: permissionOf('assessment.formula.author'),
  }),
  // this plugin's arithmetic editing its own configuration in the seat
  // beside the question editor's chooser; the chooser's option itself is
  // offered at build time, by ./server/authoring-surface.ts. The component
  // stays internal: the registry builds its import from the reference here,
  // so a package export would only widen what neighbours can reach
  Ui.surfaces({
    slots: [
      {
        key: calculatorEditorSlot.key,
        id: 'assessment-formula/calculator-editor',
        component: Ui.react('./client/CalculatorEditor'),
        visibility: permissionOf('assessment.batch.manage'),
        order: 20,
      },
      {
        key: calculatorSummarySlot.key,
        id: 'assessment-formula/calculator-summary',
        component: Ui.react('./client/CalculatorSummary'),
        visibility: permissionOf('assessment.batch.manage'),
        order: 20,
      },
    ],
  }),
  Ui.i18n('./client/i18n'),
)

export default plugin
