import { Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { message } from '@qualy/i18n-contract'
import { ADMIN_SHELL, PUBLIC, navigationGroups, permissionOf } from '@qualy/ui-contract'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { assessmentApiGroup } from './api.ts'
import { schedulerLayer } from './phase/scheduler.ts'
import { assessmentApiHandlers, serviceLayer } from './server/index.ts'

// The assessment bounded context: its tables, its permission codes, its api
// group, the service the batch screens talk to, and the fiber that writes
// down the boundaries the clock has crossed. Pages and the item-type and
// calculator extension points land with their own milestones.

const plugin = Plugin.define(
  '@qualy/plugin-assessment',
  {
    dependsOn: [
      '@qualy/plugin-auth',
      '@qualy/plugin-database',
      '@qualy/plugin-org',
      '@qualy/plugin-rbac',
      '@qualy/plugin-ui-registry',
    ],
  },
  Db.entities(entities, {
    compositeForeignKeys,
    dependsOn: ['@qualy/plugin-org', '@qualy/plugin-auth', '@qualy/plugin-rbac'],
  }),
  Access.permissions('assessment', permissions),
  Ui.i18n('./client/i18n.ts'),
  // the sidebar section this domain owns; its pages file under it by id
  Ui.surfaces({
    collections: [
      {
        key: navigationGroups.key,
        id: 'assessment/main',
        value: {
          id: 'assessment/main',
          label: message('assessment/nav-group/main', 'Assessment'),
          order: 20,
        },
        visibility: PUBLIC,
      },
    ],
  }),
  Ui.page({
    id: 'assessment/batches',
    path: '/assessment/batches',
    component: Ui.react('./client/BatchListPage.tsx'),
    layout: ADMIN_SHELL,
    visibility: permissionOf('assessment.batch.manage'),
    navigation: {
      label: message('assessment/navigation/batches', 'Batch management'),
      order: 10,
      group: 'assessment/main',
    },
  }),
  // One batch, and its sections. The address names the batch and which of its
  // sections is open, so a reload and a shared link both land where the
  // reader was; the batch on its own sends them to the first section.
  Ui.page({
    id: 'assessment/batch',
    path: '/assessment/batches/:batchId',
    component: Ui.react('./client/BatchPage.tsx'),
    layout: ADMIN_SHELL,
    visibility: permissionOf('assessment.batch.manage'),
  }),
  Ui.page({
    id: 'assessment/batch-phases',
    path: '/assessment/batches/:batchId/phases',
    component: Ui.react('./client/BatchPhasesPage.tsx'),
    layout: ADMIN_SHELL,
    visibility: permissionOf('assessment.batch.manage'),
  }),
  Ui.page({
    id: 'assessment/batch-participants',
    path: '/assessment/batches/:batchId/participants',
    component: Ui.react('./client/BatchParticipantsPage.tsx'),
    layout: ADMIN_SHELL,
    visibility: permissionOf('assessment.batch.manage'),
  }),
  Api.group(assessmentApiGroup, assessmentApiHandlers),
  Plugin.layer(serviceLayer),
  // provided the service rather than merged with it: the fiber consumes the
  // service and exports nothing, so it stays out of everybody else's graph
  Plugin.layer(schedulerLayer.pipe(Layer.provide(serviceLayer))),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export { assessmentApiHandlers as apiHandlers } from './server/index.ts'
