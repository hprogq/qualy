import { Plugin } from '@qualy/plugin-kit'
import { Db } from '@qualy/plugin-database/plugin'
import { Api } from '@qualy/api-kit/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { APP_SHELL, permissionOf } from '@qualy/ui-contract'
import { message } from '@qualy/i18n-contract'
import { permissions } from './permissions.ts'
import { formulaActions } from './actions.ts'
import { formulaApiGroup } from './api.ts'
import { formulaApiHandlers, layer as serviceLayer } from './server/index.ts'
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
    // the tenant foreign key is the one edge out of this plugin's tables
    dependsOn: ['@qualy/plugin-org'],
  }),
  Access.permissions('assessment-formula', permissions),
  Audit.actions('assessment-formula', formulaActions),
  Plugin.layer(serviceLayer),
  Api.group(formulaApiGroup, formulaApiHandlers),
  Ui.page({
    id: 'assessment-formula/list',
    path: '/assessment/formulas',
    component: Ui.react('./client/FormulaListPage.tsx'),
    layout: APP_SHELL,
    title: message('assessment-formula/list/title', 'Scoring formulas'),
    visibility: permissionOf('assessment.formula.manage'),
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
    visibility: permissionOf('assessment.formula.manage'),
  }),
  Ui.i18n('./client/i18n.ts'),
)

export default plugin
