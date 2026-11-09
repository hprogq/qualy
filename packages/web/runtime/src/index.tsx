export { Failure } from './feedback/failure.tsx'
export {
  LoadFailure,
  useLoadFailure,
  type LoadFailureOptions,
  type LoadFailureWayBack,
  type LoadFailureWords,
} from './feedback/load-failure.tsx'
export { isRecordId, loadFailureKind, subjectFailureKind } from './feedback/failure-kind.ts'
export {
  buildPageHref,
  sessionDestinationHref,
  type PageHrefOptions,
  type SessionDestination,
} from './routing/pages.ts'
export {
  emptyComponentRegistry,
  resolveSurface,
  type ComponentRegistry,
  type RegisteredComponent,
} from './surfaces/registry.ts'
export {
  PluginComponent,
  PluginComponentBoundary,
  type PluginComponentProps,
} from './surfaces/component-boundary.tsx'
export { cursorPages } from './data/api-query.ts'
// a sign-in opened by a session's recovery, and how it says it is done
export {
  announceSignedIn,
  listenForWaitingPage,
  SESSION_RESUME_PARAM,
} from './session/session-recovery.ts'
export {
  LIVE_GRACE_MS,
  LiveChannels,
  liveBackoffMs,
  type LiveChannelsOptions,
  type LiveChannelState,
  type LiveHolder,
  type LiveTiming,
} from './live/live-channel.ts'
export { useLiveChannel } from './live/live-channel-context.tsx'
export { PageLink } from './routing/links.tsx'
export { usePendingNavigation, type PendingNavigation } from './routing/navigation.tsx'
export { NavigationProgressScope, useNavigationProgress } from './routing/navigation-progress.tsx'
export { ThemeProvider, useTheme, type ThemeChoice } from './theme.tsx'
export { useHydrating } from './document/hydrating.ts'
export { DocumentNow, useDocumentNow } from './document/document-now.tsx'

export {
  RuntimeContext,
  useDocumentContext,
  useManifest,
  useManifestPage,
  usePageAvailable,
  usePageHref,
  useRuntime,
  type ClientProvider,
  type Manifest,
  type Runtime,
} from './runtime-context.tsx'

export {
  WorkspaceCapabilityScope,
  useWorkspaceCapabilities,
  usePublishWorkspaceCapabilities,
  type WorkspaceCapabilities,
} from './document/workspace-capabilities.tsx'
export {
  SCREEN_FOOT,
  ScreenFoot,
  ScreenFootScope,
  useScreenFootClaimed,
  useClaimScreenFoot,
  type ScreenFootAt,
} from './document/screen-foot.tsx'
export { SCREEN_ASIDE, ScreenAsideScope, useScreenAsideOffered } from './document/screen-aside.tsx'
export {
  SCREEN_FILL,
  ScreenFill,
  ScreenFillScope,
  useScreenFillClaimed,
  type ScreenFillFrom,
} from './document/screen-fill.tsx'
export { SubjectAbsence, SubjectScope, useSubjectAbsenceSeat } from './document/subject.tsx'
export {
  DataRouterLeaveGuard,
  useLeaveGuard,
  useUnguardedMove,
  type LeaveGuardOptions,
} from './routing/leave-guard.tsx'
export { PageTitleScope, usePageTitle, usePageTitleClaim } from './document/page-title.tsx'
export { RouteMetadata } from './document/route-metadata.tsx'
export { RuntimeProvider, type RuntimeProviderProps } from './runtime-provider.tsx'
export { useSessionTransition, useManifestRefresh } from './session/session-transition.ts'
export {
  useApi,
  useApiQuery,
  useRunApi,
  useApiMutation,
  useHandlePlatformFailure,
  type ApiMutationOptions,
  type PlatformFailureOptions,
} from './data/api-hooks.ts'
export {
  usePageNavigate,
  usePageQueryState,
  usePageQueryUpdate,
  usePageRouteParams,
} from './routing/page-hooks.ts'
export { PluginSurface, UiSlot, useUiCollection } from './surfaces/surfaces.tsx'
