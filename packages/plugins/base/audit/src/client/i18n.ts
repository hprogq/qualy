import { definePluginMessages } from '@qualy/i18n-contract'

// The audit screen's own words, plus the labels the server sends by
// reference: the permission this plugin declares and the navigation entry.

const i18n = definePluginMessages({
  namespace: 'audit',
  messages: {
    'permission.audit.event.read': {
      id: 'audit/permission/event-read',
      defaultMessage: 'View the audit log',
    },
    permissionGroup: {
      id: 'audit/permission-group/audit',
      defaultMessage: 'Audit',
    },
    navigation: {
      id: 'audit/navigation/events',
      defaultMessage: 'Audit log',
    },
    title: {
      id: 'audit/events/title',
      defaultMessage: 'Audit log',
    },
    hint: {
      id: 'audit/events/hint',
      defaultMessage: 'Administrative operations, newest first.',
    },
    anyAction: {
      id: 'audit/events/any-action',
      defaultMessage: 'Every action',
    },
    anyOutcome: {
      id: 'audit/events/any-outcome',
      defaultMessage: 'Every outcome',
    },
    columnTime: { id: 'audit/events/column-time', defaultMessage: 'Time' },
    columnActor: { id: 'audit/events/column-actor', defaultMessage: 'Operator' },
    columnAction: { id: 'audit/events/column-action', defaultMessage: 'Action' },
    columnTarget: { id: 'audit/events/column-target', defaultMessage: 'Object' },
    columnOutcome: { id: 'audit/events/column-outcome', defaultMessage: 'Outcome' },
    columnIp: { id: 'audit/events/column-ip', defaultMessage: 'IP' },
    outcomeSuccess: { id: 'audit/events/outcome-success', defaultMessage: 'Success' },
    outcomeDenied: { id: 'audit/events/outcome-denied', defaultMessage: 'Denied' },
    outcomeFailure: { id: 'audit/events/outcome-failure', defaultMessage: 'Failure' },
    actorSystem: { id: 'audit/events/actor-system', defaultMessage: 'System' },
    actorAnonymous: { id: 'audit/events/actor-anonymous', defaultMessage: 'Anonymous' },
    empty: {
      id: 'audit/events/empty',
      defaultMessage: 'No events match the current filters.',
    },
    loadedCount: {
      id: 'audit/events/loaded-count',
      defaultMessage: '{count, plural, one {# event listed} other {# events listed}}',
    },
    loadMore: { id: 'audit/events/load-more', defaultMessage: 'Load more' },
    detailRequest: { id: 'audit/events/detail-request', defaultMessage: 'Request' },
    detailTrace: { id: 'audit/events/detail-trace', defaultMessage: 'Trace' },
    detailSource: { id: 'audit/events/detail-source', defaultMessage: 'Source' },
    detailReason: { id: 'audit/events/detail-reason', defaultMessage: 'Reason' },
    detailUserAgent: { id: 'audit/events/detail-user-agent', defaultMessage: 'Browser' },
    detailDetails: { id: 'audit/events/detail-details', defaultMessage: 'Details' },
    loadFailed: {
      id: 'audit/events/load-failed',
      defaultMessage: 'The audit log could not be loaded.',
    },
  },
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const auditMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
