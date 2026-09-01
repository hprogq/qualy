import { Plugin } from '@qualy/plugin-kit'
import { Db } from '@qualy/plugin-database/plugin'
import { Api } from '@qualy/api-kit/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Scoring } from '@qualy/plugin-assessment/plugin'
import { calculatorAuthoringOptions, calculatorEditorSlot } from '@qualy/plugin-assessment/surfaces'
import { APP_SHELL, permissionOf } from '@qualy/ui-contract'
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
  },
  Db.entities(entities, {
    compositeForeignKeys,
    // org owns the tenant these tables hang on and the units a share scope
    // points at; auth owns the people a template names as its author
    dependsOn: ['@qualy/plugin-org', '@qualy/plugin-auth'],
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
      // the runtime half: siblings of the library with no edge between
      // them - resolution consults no authoring state, and 7.3's
      // calculator bind is where both get consumed together
      runtimeStoreLayer,
      bindingCatalogLayer,
      // the audience half: what a published version has been offered to,
      // which the private library above deliberately knows nothing about
      templateLibraryLayer,
    ),
  ),
  Api.group(formulaApiGroup, formulaApiHandlers),
  Ui.page({
    id: 'assessment-formula/list',
    path: '/assessment/formulas',
    component: Ui.react('./client/FormulaListPage.tsx'),
    layout: APP_SHELL,
    title: message('assessment-formula/list/title', 'Scoring formulas'),
    visibility: permissionOf('assessment.formula.author'),
    navigation: {
      label: message('assessment-formula/navigation/formulas', 'Scoring formulas'),
      order: 20,
      group: 'assessment/main',
    },
  }),
  Ui.page({
    id: 'assessment-formula/editor',
    path: '/assessment/formulas/:functionId',
    component: Ui.react('./client/FormulaEditorPage.tsx'),
    layout: APP_SHELL,
    title: message('assessment-formula/list/title', 'Scoring formulas'),
    visibility: permissionOf('assessment.formula.author'),
  }),
  // this plugin's arithmetic, offered in the question editor's own chooser
  // and editing its own configuration in the seat beside it. The component
  // stays internal: the registry builds its import from the reference here,
  // so a package export would only widen what neighbours can reach
  Ui.surfaces({
    collections: [
      {
        key: calculatorAuthoringOptions.key,
        id: 'assessment-formula/calculator',
        value: {
          ref: 'formula@1',
          label: message('assessment-formula/binding/calculator', 'A published formula'),
          order: 20,
        },
        visibility: permissionOf('assessment.batch.manage'),
      },
    ],
    slots: [
      {
        key: calculatorEditorSlot.key,
        id: 'assessment-formula/calculator-editor',
        component: Ui.react('./client/CalculatorEditor.tsx'),
        visibility: permissionOf('assessment.batch.manage'),
        order: 20,
      },
    ],
  }),
  Ui.i18n('./client/i18n.ts'),
)

export default plugin
