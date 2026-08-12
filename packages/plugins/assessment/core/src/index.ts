import { Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { message } from '@qualy/i18n-contract'
import {
  APP_SHELL,
  AUTHENTICATED,
  PUBLIC,
  WORKSPACE_SHELL,
  navigationGroups,
  permissionOf,
  workspaceContext,
  workspaceNavigation,
} from '@qualy/ui-contract'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { ItemTypes, Scoring } from './plugin.ts'
import { builtinScoringDrivers } from './scoring/builtins.ts'
import { permissions } from './permissions.ts'
import { assessmentApiGroup } from './api.ts'
import { schedulerLayer } from './phase/scheduler.ts'
import { assessmentApiHandlers, serviceLayer } from './server/index.ts'

// The assessment bounded context: its tables, its permission codes, its api
// group, the service the batch screens talk to, the fiber that writes down
// the boundaries the clock has crossed, and the two channels other plugins
// extend it through - item types and scoring arithmetic. Core contributes
// the arithmetic every deployment starts with; the first item-type driver is
// the evidence plugin's.

const plugin = Plugin.define(
  '@qualy/plugin-assessment',
  {
    dependsOn: [
      '@qualy/plugin-auth',
      '@qualy/plugin-database',
      '@qualy/plugin-org',
      '@qualy/plugin-rbac',
      '@qualy/plugin-storage',
      '@qualy/plugin-ui-registry',
    ],
  },
  Db.entities(entities, {
    compositeForeignKeys,
    // storage joined in M2: the attachment relation table holds a real
    // foreign key into storage_attachments
    dependsOn: [
      '@qualy/plugin-org',
      '@qualy/plugin-auth',
      '@qualy/plugin-rbac',
      '@qualy/plugin-storage',
    ],
  }),
  ItemTypes.provider,
  Scoring.provider,
  ...builtinScoringDrivers.map((driver) => Scoring.driver(driver)),
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
      // Running an assessment: the rounds themselves and the templates they
      // are built from. The other three clusters the product is heading for -
      // submissions, reviews, and what a participant sees of their own - are
      // recorded in docs/assessment-design.md and declared when they have a
      // page to lead to; an entry that leads nowhere is worse than no entry.
      // Inside one batch the rail says what can be done to it, in groups
      // that name who is doing it rather than what the software calls it:
      // taking part, handling other people's work, running the batch.
      {
        key: navigationGroups.key,
        id: 'assessment/batch-admin',
        value: {
          id: 'assessment/batch-admin',
          label: message('assessment/nav-group/batch-admin', 'Managing'),
          order: 30,
        },
        visibility: PUBLIC,
      },
    ],
  }),
  Ui.page({
    id: 'assessment/batches',
    path: '/assessment/batches',
    component: Ui.react('./client/BatchListPage.tsx'),
    layout: APP_SHELL,
    // the list answers "which rounds are mine", which everybody has an answer
    // to; what it contains is decided per reader, not per permission
    visibility: AUTHENTICATED,
    navigation: {
      label: message('assessment/navigation/batches', 'Assessment rounds'),
      order: 10,
      group: 'assessment/main',
    },
  }),
  // One batch, and its sections. The address names the batch and which of its
  // sections is open, so a reload and a shared link both land where the
  // reader was; the batch on its own sends them to the first section.
  // Where a batch opens. Whoever takes part in one may read it; everything
  // that configures it is a section of its own behind the permission.
  Ui.page({
    id: 'assessment/batch',
    path: '/assessment/batches/:batchId',
    component: Ui.react('./client/BatchOverviewPage.tsx'),
    layout: WORKSPACE_SHELL,
    visibility: AUTHENTICATED,
    title: message('assessment/navigation/overview', 'Overview'),
  }),
  Ui.page({
    id: 'assessment/batch-phases',
    path: '/assessment/batches/:batchId/phases',
    component: Ui.react('./client/BatchPhasesPage.tsx'),
    layout: WORKSPACE_SHELL,
    title: message('assessment/navigation/phases', 'Stage plan'),
    visibility: permissionOf('assessment.batch.manage'),
  }),
  Ui.page({
    id: 'assessment/batch-participants',
    path: '/assessment/batches/:batchId/participants',
    component: Ui.react('./client/BatchParticipantsPage.tsx'),
    layout: WORKSPACE_SHELL,
    title: message('assessment/navigation/participants', 'Participants'),
    visibility: permissionOf('assessment.batch.manage'),
  }),
  Ui.page({
    id: 'assessment/batch-access',
    path: '/assessment/batches/:batchId/access',
    component: Ui.react('./client/BatchAccessPage.tsx'),
    layout: WORKSPACE_SHELL,
    title: message('assessment/navigation/access', 'Staffs'),
    visibility: permissionOf('assessment.batch.manage'),
  }),
  Ui.page({
    id: 'assessment/batch-settings',
    path: '/assessment/batches/:batchId/settings',
    component: Ui.react('./client/BatchSettingsPage.tsx'),
    layout: WORKSPACE_SHELL,
    title: message('assessment/navigation/settings', 'Settings'),
    visibility: permissionOf('assessment.batch.manage'),
  }),
  // What the rail offers inside a batch, and the bar that says which batch it
  // is. Both are contributions to the workspace shell: it renders them and
  // knows nothing about batches, and this plugin names no shell of its own.
  Ui.surfaces({
    collections: [
      {
        // above the sections rather than in one: it is where a batch opens,
        // and it belongs to whoever opened it - a participant, a reviewer or
        // whoever runs the round
        key: workspaceNavigation.key,
        id: 'assessment/batch-overview/rail',
        value: {
          id: 'assessment/batch-overview/rail',
          label: message('assessment/navigation/overview', 'Overview'),
          target: { kind: 'page', pageId: 'assessment/batch' },
          icon: 'layout-dashboard',
          order: 0,
        },
        visibility: AUTHENTICATED,
      },
      {
        key: workspaceNavigation.key,
        id: 'assessment/batch-phases/rail',
        value: {
          id: 'assessment/batch-phases/rail',
          label: message('assessment/navigation/phases', 'Stage plan'),
          target: { kind: 'page', pageId: 'assessment/batch-phases' },
          icon: 'calendar-clock',
          order: 10,
          group: 'assessment/batch-admin',
        },
        visibility: permissionOf('assessment.batch.manage'),
      },
      {
        key: workspaceNavigation.key,
        id: 'assessment/batch-participants/rail',
        value: {
          id: 'assessment/batch-participants/rail',
          label: message('assessment/navigation/participants', 'Participants'),
          target: { kind: 'page', pageId: 'assessment/batch-participants' },
          icon: 'users',
          order: 20,
          group: 'assessment/batch-admin',
        },
        visibility: permissionOf('assessment.batch.manage'),
      },
      {
        key: workspaceNavigation.key,
        id: 'assessment/batch-access/rail',
        value: {
          id: 'assessment/batch-access/rail',
          label: message('assessment/navigation/access', 'Staffs'),
          target: { kind: 'page', pageId: 'assessment/batch-access' },
          icon: 'shield-check',
          order: 30,
          group: 'assessment/batch-admin',
        },
        visibility: permissionOf('assessment.batch.manage'),
      },
      {
        key: workspaceNavigation.key,
        id: 'assessment/batch-settings/rail',
        value: {
          id: 'assessment/batch-settings/rail',
          label: message('assessment/navigation/settings', 'Settings'),
          target: { kind: 'page', pageId: 'assessment/batch-settings' },
          icon: 'settings',
          order: 40,
          group: 'assessment/batch-admin',
        },
        visibility: permissionOf('assessment.batch.manage'),
      },
    ],
    slots: [
      {
        key: workspaceContext.key,
        id: 'assessment/batch-context',
        component: Ui.react('./client/batch/BatchContextBar.tsx'),
        visibility: AUTHENTICATED,
      },
    ],
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
