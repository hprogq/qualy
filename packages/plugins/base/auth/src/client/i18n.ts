import {
  defineErrorTranslations,
  defineMessage,
  selectKey,
  definePluginMessages,
  type ErrorsByCode,
} from '@qualy/i18n-contract'
import type * as authErrors from '../server/errors.ts'
import type * as signInFailures from '@qualy/auth-contract/sign-in-failure'

// the interpolating messages declare their placeholders
// sentences that carry the tenant's own word for a person's identifier:
// the word is a term (useTerm), the sentence around it stays this catalog's
const pickerSearchMessage = defineMessage<{ businessNo: string }>()({
  id: 'auth/picker/search',
  defaultMessage: 'Name or {businessNo}',
})
const noBusinessNoMessage = defineMessage<{ businessNo: string }>()({
  id: 'auth/session/no-business-no',
  defaultMessage: 'No {businessNo}',
})
const personNoBusinessNoMessage = defineMessage<{ businessNo: string }>()({
  id: 'auth/person/no-business-no',
  defaultMessage: 'No {businessNo}',
})
const userCountMessage = defineMessage<{ count: number }>()({
  id: 'auth/user-types/user-count',
  defaultMessage: '{count, plural, one {# user} other {# users}}',
})
const userTypeInUseMessage = defineMessage<{ userCount: number }>()({
  id: 'auth/error/user-type-in-use',
  defaultMessage:
    '{userCount, plural, one {# user still has} other {# users still have}} this type.',
})
const userTypeLastForRoleMessage = defineMessage<{ roleCount: number }>()({
  id: 'auth/error/user-type-last-for-role',
  defaultMessage:
    '{roleCount, plural, one {# role allows} other {# roles allow}} this user type and no other.',
})
const passwordDialogTitleMessage = defineMessage<{ name: string }>()({
  id: 'auth/person/password-title',
  defaultMessage: 'Set the {name} password',
})
const byBusinessNoMessage = defineMessage<{ businessNo: string }>()({
  id: 'auth/person/by-business-no',
  defaultMessage: 'Signs in by {businessNo}, nothing to bind',
})
const businessNoMissingMessage = defineMessage<{ businessNo: string }>()({
  id: 'auth/person/business-no-missing',
  defaultMessage: 'No {businessNo} yet',
})
const jumpLabelMessage = defineMessage<{ businessNo: string }>()({
  id: 'auth/users/jump',
  defaultMessage: 'Name or {businessNo}',
})
const jumpFoundMessage = defineMessage<{ count: number }>()({
  id: 'auth/users/jump-found',
  defaultMessage: '{count, plural, one {# person matches} other {# people match}}',
})
const jumpHintMessage = defineMessage<{ businessNo: string }>()({
  id: 'auth/users/jump-hint',
  defaultMessage: 'Type a name or a {businessNo}. Arrows choose, Enter opens their page',
})
const methodNamed = (id: string, defaultMessage: string) =>
  defineMessage<{ name: string }>()({ id, defaultMessage })
const methodSecretClearLabelMessage = defineMessage<{ field: string }>()({
  id: 'auth/login-methods/secret-clear-label',
  defaultMessage: 'Clear {field}',
})
const methodMissingMessage = defineMessage<{ fields: string }>()({
  id: 'auth/login-methods/missing',
  defaultMessage: 'Still needed: {fields}',
})
const methodDeleteBodyMessage = defineMessage<{ bindings: number; sessions: number }>()({
  id: 'auth/login-methods/delete-body',
  defaultMessage:
    '{bindings, plural, =0 {No bound account} one {# bound account} other {# bound accounts}} will be withdrawn and {sessions, plural, =0 {no session} one {# session} other {# sessions}} will end. This cannot be undone.',
})
const methodMoveMessage = defineMessage<{ name: string }>()({
  id: 'auth/login-methods/move',
  defaultMessage: 'Move {name}. Drag, or use the up and down arrows',
})
const methodMoveUpMessage = defineMessage<{ name: string }>()({
  id: 'auth/login-methods/move-up',
  defaultMessage: 'Move {name} up',
})
const methodMoveDownMessage = defineMessage<{ name: string }>()({
  id: 'auth/login-methods/move-down',
  defaultMessage: 'Move {name} down',
})
const moveConfirmMessage = defineMessage<{ name: string; from: string; to: string }>()({
  id: 'auth/users/move-confirm-body',
  defaultMessage:
    'Move {name} from {from} to {to}. Every authority that follows the unit follows them.',
})
const lookAtMessage = defineMessage<{ name: string }>()({
  id: 'auth/users/look-at',
  defaultMessage: 'Look at {name}',
})
const pageSummaryMessage = defineMessage<{ from: number; to: number; total: number }>()({
  id: 'auth/users/page-summary',
  defaultMessage: '{from}-{to} of {total}',
})
const lastUsedMessage = defineMessage<{ when: string }>()({
  id: 'auth/person/last-used',
  defaultMessage: 'Last used {when}',
})
const sessionActiveMessage = defineMessage<{ when: string }>()({
  id: 'auth/sessions/active',
  defaultMessage: 'Active {when}',
})
const recordsSummaryMessage = defineMessage<{ from: number; to: number; total: number }>()({
  id: 'auth/activity/summary',
  defaultMessage: '{from}-{to} of {total}',
})
const sessionsEndedMessage = defineMessage<{ count: number }>()({
  id: 'auth/sessions/ended',
  defaultMessage:
    '{count, plural, =0 {No other session was signed in} one {Signed out of 1 session} other {Signed out of # sessions}}',
})
const audienceSummaryMessage = defineMessage<{ count: number }>()({
  id: 'auth/login-methods/audience-summary',
  defaultMessage:
    '{count, plural, =0 {Open to no user type} one {Open to 1 user type} other {Open to # user types}}',
})
const roleCountMessage = defineMessage<{ count: number }>()({
  id: 'auth/user-types/role-count',
  defaultMessage: '{count, plural, one {# role} other {# roles}}',
})
const providerPositionMessage = defineMessage<{ position: number }>()({
  id: 'auth/login-methods/position',
  defaultMessage: 'No. {position} on the sign-in page',
})
const peopleTallyMessage = defineMessage<{ count: string }>()({
  id: 'auth/login-methods/people-tally',
  defaultMessage: '{count} people',
})
const inUseBlockerMessage = defineMessage<{ count: number }>()({
  id: 'auth/user-types/blocker-in-use',
  defaultMessage:
    '{count, plural, one {# person holds} other {# people hold}} this type, so it can be neither disabled nor deleted.',
})
const iconInvalidMessage = defineMessage<{ reason: string }>()({
  id: 'auth/error/provider-icon-invalid',
  defaultMessage:
    '{reason, select, svg {That SVG carries scripts, outside references or elements an icon cannot use. Export it as plain shapes.} lightFirst {Upload the image for a light surface first.} other {Use a PNG, JPEG or WebP image up to 256 KB, or an SVG up to 64 KB.}}',
})
const placementInUseMessage = defineMessage<{ userCount: number }>()({
  id: 'auth/error/user-type-placement-in-use',
  defaultMessage:
    '{userCount, plural, one {# user stands} other {# users stand}} where this change would no longer allow.',
})
const grantIncompatibleMessage = defineMessage<{ grantCount: number }>()({
  id: 'auth/error/grant-incompatible',
  defaultMessage:
    '{grantCount, plural, one {# role grant does} other {# role grants do}} not allow this change.',
})

const pickerChosen = defineMessage<{ count: number }>()({
  id: 'auth/picker/chosen',
  defaultMessage: '{count, plural, =0 {Nobody chosen} other {# chosen}}',
})

const pickerChosenElsewhere = defineMessage<{ count: number }>()({
  id: 'auth/picker/chosen-elsewhere',
  defaultMessage: '{count} on other pages',
})

const pickerRemove = defineMessage<{ name: string }>()({
  id: 'auth/picker/remove',
  defaultMessage: 'Remove {name}',
})

const nodeRemove = defineMessage<{ name: string }>()({
  id: 'auth/picker/node-remove',
  defaultMessage: 'Remove {name}',
})

const personRoleSubtree = defineMessage<{ node: string }>()({
  id: 'auth/person/role-subtree',
  defaultMessage: '{node} and everything under it',
})

const personRoleHere = defineMessage<{ node: string }>()({
  id: 'auth/person/role-here',
  defaultMessage: 'at {node}',
})

const i18n = definePluginMessages({
  namespace: 'auth',
  messages: {
    // the words the settings screen shows for what this plugin lets a tenant
    // rename; the term itself is declared in the auth contract
    settingsCategoryIdentity: {
      id: 'auth/settings/category/identity',
      defaultMessage: 'People and sign-in',
    },
    settingsTermBusinessNumber: {
      id: 'auth/settings/term/business-number',
      defaultMessage: 'Person identifier',
    },
    settingsTermBusinessNumberDescription: {
      id: 'auth/settings/term/business-number-description',
      defaultMessage: 'The business identifier assigned to a person in this tenant.',
    },
    // one label per permission this plugin declares. The definition
    // carries a message reference, so the role editor renders whatever
    // language its reader asked for rather than the one it was authored in.
    'permission.auth.user-type.read': {
      id: 'auth/permission/user-type-read',
      defaultMessage: 'View user types',
    },
    'permission.auth.user-type.manage': {
      id: 'auth/permission/user-type-manage',
      defaultMessage: 'Manage user types',
    },
    'permission.auth.provider.read': {
      id: 'auth/permission/provider-read',
      defaultMessage: 'View login methods',
    },
    'permission.auth.provider.manage': {
      id: 'auth/permission/provider-manage',
      defaultMessage: 'Manage login methods',
    },
    'permission.auth.user.read': {
      id: 'auth/permission/user-read',
      defaultMessage: 'View users',
    },
    'permission.auth.user.manage': {
      id: 'auth/permission/user-manage',
      defaultMessage: 'Manage users',
    },
    'permission.auth.user.delete': {
      id: 'auth/permission/user-delete',
      defaultMessage: 'Delete users',
    },
    // one label per audit action this plugin declares; the audit screen
    // renders whatever language its reader asked for
    'audit.auth.user.create': { id: 'auth/audit/user-create', defaultMessage: 'Create user' },
    'audit.auth.user.update': { id: 'auth/audit/user-update', defaultMessage: 'Edit user' },
    'audit.auth.provider.create': {
      id: 'auth/audit/provider-create',
      defaultMessage: 'Add an entrance',
    },
    'audit.auth.provider.update': {
      id: 'auth/audit/provider-update',
      defaultMessage: 'Edit an entrance',
    },
    'audit.auth.provider.delete': {
      id: 'auth/audit/provider-delete',
      defaultMessage: 'Delete an entrance',
    },
    'audit.auth.provider.status': {
      id: 'auth/audit/provider-status',
      defaultMessage: 'Enable or disable an entrance',
    },
    'audit.auth.provider.reorder': {
      id: 'auth/audit/provider-reorder',
      defaultMessage: 'Reorder the sign-in page',
    },
    'audit.auth.provider.recommend': {
      id: 'auth/audit/provider-recommend',
      defaultMessage: 'Choose the recommended way to sign in',
    },
    'audit.auth.provider.icon': {
      id: 'auth/audit/provider-icon',
      defaultMessage: 'Change how a way to sign in is drawn',
    },
    'audit.auth.identity.bind': {
      id: 'auth/audit/identity-bind',
      defaultMessage: 'Set a sign-in credential for a user',
    },
    'audit.auth.identity.revoke': {
      id: 'auth/audit/identity-revoke',
      defaultMessage: 'Withdraw a sign-in binding from a user',
    },
    'audit.auth.user.move': { id: 'auth/audit/user-move', defaultMessage: 'Move user' },
    'audit.auth.session.revoke': {
      id: 'auth/audit/session-revoke',
      defaultMessage: 'End sign-in sessions',
    },
    // what the person an action happened to reads in their own activity
    'audit-subject.auth.user.update': {
      id: 'auth/audit-subject/user-update',
      defaultMessage: 'Your account details were changed',
    },
    'audit-subject.auth.user.move': {
      id: 'auth/audit-subject/user-move',
      defaultMessage: 'Your unit was changed',
    },
    'audit-subject.auth.user.enable': {
      id: 'auth/audit-subject/user-enable',
      defaultMessage: 'Your account was enabled',
    },
    'audit-subject.auth.user.disable': {
      id: 'auth/audit-subject/user-disable',
      defaultMessage: 'Your account was disabled',
    },
    'audit-subject.auth.identity.bind': {
      id: 'auth/audit-subject/identity-bind',
      defaultMessage: 'A way to sign in was set or changed',
    },
    'audit-subject.auth.identity.revoke': {
      id: 'auth/audit-subject/identity-revoke',
      defaultMessage: 'A way to sign in was removed',
    },
    'audit-subject.auth.session.revoke': {
      id: 'auth/audit-subject/session-revoke',
      defaultMessage: 'Signed out on other devices',
    },
    'audit.auth.user.enable': { id: 'auth/audit/user-enable', defaultMessage: 'Enable user' },
    'audit.auth.user.disable': { id: 'auth/audit/user-disable', defaultMessage: 'Disable user' },
    'audit.auth.user.delete': { id: 'auth/audit/user-delete', defaultMessage: 'Delete user' },
    'audit.auth.user.restore': { id: 'auth/audit/user-restore', defaultMessage: 'Restore user' },
    'audit.auth.user-type.create': {
      id: 'auth/audit/user-type-create',
      defaultMessage: 'Create user type',
    },
    'audit.auth.user-type.update': {
      id: 'auth/audit/user-type-update',
      defaultMessage: 'Edit user type',
    },
    'audit.auth.user-type.enable': {
      id: 'auth/audit/user-type-enable',
      defaultMessage: 'Enable user type',
    },
    'audit.auth.user-type.disable': {
      id: 'auth/audit/user-type-disable',
      defaultMessage: 'Disable user type',
    },
    'audit.auth.user-type.placement': {
      id: 'auth/audit/user-type-placement',
      defaultMessage: 'Change where a user type may stand',
    },
    'audit.auth.user-type.delete': {
      id: 'auth/audit/user-type-delete',
      defaultMessage: 'Delete user type',
    },
    'audit.auth.provider.audience': {
      id: 'auth/audit/provider-audience',
      defaultMessage: 'Change who may sign in through an entrance',
    },
    title: { id: 'auth/login/title', defaultMessage: 'Sign in to Qualy' },
    chooseMethod: { id: 'auth/login/choose', defaultMessage: 'Choose a way to sign in' },
    otherMethodsHeading: { id: 'auth/login/others', defaultMessage: 'Other ways to sign in' },
    demoHeading: { id: 'auth/login/demo', defaultMessage: 'Try a demo account' },
    allOtherMethods: {
      id: 'auth/login/all-others',
      defaultMessage: 'All {count, plural, one {# other way} other {# other ways}}',
    },
    otherMethodsCount: {
      id: 'auth/login/others-count',
      defaultMessage: '{count, plural, one {# way} other {# ways}}',
    },
    signInWith: { id: 'auth/login/sign-in-with', defaultMessage: 'Sign in with {name}' },
    searchMethods: { id: 'auth/login/search', defaultMessage: 'Search ways to sign in' },
    noMethodMatch: { id: 'auth/login/no-match', defaultMessage: 'No way to sign in by that name' },
    back: { id: 'auth/login/back', defaultMessage: 'Back' },
    lastWayIn: { id: 'auth/login/last-used', defaultMessage: 'Last used' },
    lastUsedName: { id: 'auth/login/last-used-name', defaultMessage: '{name}, last used' },
    goingTo: { id: 'auth/login/going-to', defaultMessage: 'Going to {name}…' },
    stayHere: { id: 'auth/login/stay', defaultMessage: 'Cancel' },
    noMethodsTitle: {
      id: 'auth/login/no-methods-title',
      defaultMessage: 'Signing in is unavailable',
    },
    dismiss: { id: 'auth/login/dismiss', defaultMessage: 'Dismiss' },
    signInElsewhere: {
      id: 'auth/login/elsewhere',
      defaultMessage:
        'Accounts that sign in another way have no Qualy password. Recover it with that service.',
    },
    // why a sign-in that went elsewhere came back without one: what
    // happened, then what to do
    failUnboundTitle: {
      id: 'auth/login/fail-unbound',
      defaultMessage: 'This account is not linked yet',
    },
    failUnboundBody: {
      id: 'auth/login/fail-unbound-body',
      defaultMessage: 'Sign in another way, then link it under Account → Sign-in methods.',
    },
    failFlowTitle: {
      id: 'auth/login/fail-flow',
      defaultMessage: 'This sign-in expired or is already done',
    },
    failFlowBody: { id: 'auth/login/fail-flow-body', defaultMessage: 'Please sign in again.' },
    failPersonTitle: { id: 'auth/login/fail-person', defaultMessage: 'No account to sign in to' },
    failPersonBody: {
      id: 'auth/login/fail-person-body',
      defaultMessage:
        'Your identity was confirmed, but no usable account here matches it. Contact your administrator.',
    },
    failMethodTitle: {
      id: 'auth/login/fail-method',
      defaultMessage: 'This way to sign in is unavailable',
    },
    failMethodBody: { id: 'auth/login/fail-method-body', defaultMessage: 'Try another way.' },
    failAttemptsTitle: { id: 'auth/login/fail-attempts', defaultMessage: 'Too many attempts' },
    failAttemptsBody: {
      id: 'auth/login/fail-attempts-body',
      defaultMessage: 'Try again in {minutes, plural, one {# minute} other {# minutes}}.',
    },
    // a way in a product owns, drawn as a letter on its colour
    iconLetterGoogle: { id: 'auth/login/icon-google', defaultMessage: 'G' },
    iconLetterApple: { id: 'auth/login/icon-apple', defaultMessage: 'A' },
    iconLetterWechat: { id: 'auth/login/icon-wechat', defaultMessage: 'W' },
    iconLetterWecom: { id: 'auth/login/icon-wecom', defaultMessage: 'W' },
    iconLetterDingtalk: { id: 'auth/login/icon-dingtalk', defaultMessage: 'D' },
    iconLetterFeishu: { id: 'auth/login/icon-feishu', defaultMessage: 'F' },
    iconLetterQq: { id: 'auth/login/icon-qq', defaultMessage: 'Q' },
    // recovery, in the same column as signing in
    backToSignIn: { id: 'auth/reset/back', defaultMessage: 'Back to sign in' },
    resetSending: { id: 'auth/reset/sending', defaultMessage: 'Sending…' },
    resetWait: { id: 'auth/reset/wait', defaultMessage: 'Try again in {time}' },
    resetPreparingCheck: {
      id: 'auth/reset/preparing-check',
      defaultMessage: 'Preparing a security check…',
    },
    resetChecking: { id: 'auth/reset/checking', defaultMessage: 'Running a security check…' },
    resetFinishCheck: {
      id: 'auth/reset/finish-check',
      defaultMessage: 'Complete the security check to continue',
    },
    resetEmailInvalid: {
      id: 'auth/reset/email-invalid',
      defaultMessage: 'Enter a valid email address',
    },
    resetSentTitle: { id: 'auth/reset/sent-title', defaultMessage: 'Check your email' },
    resetSentBody: {
      id: 'auth/reset/sent-body',
      defaultMessage:
        'If {email} is verified, a reset link is on its way to it. It works for one hour.',
    },
    resetOtherEmail: { id: 'auth/reset/other-email', defaultMessage: 'Use another email' },
    resetSetTitle: { id: 'auth/reset/set-title', defaultMessage: 'Set a new password' },
    resetSetHint: {
      id: 'auth/reset/set-hint',
      defaultMessage: 'Every device signed in to this account will be signed out.',
    },
    resetShowPassword: { id: 'auth/reset/show', defaultMessage: 'Show password' },
    resetLength: {
      id: 'auth/reset/length',
      defaultMessage: 'At least {min, plural, other {# characters}}',
    },
    resetLengthShort: {
      id: 'auth/reset/length-short',
      defaultMessage:
        'At least {min, plural, other {# characters}}, {left, plural, one {# more to go} other {# more to go}}',
    },
    resetMatch: { id: 'auth/reset/match', defaultMessage: 'Both entries match' },
    passwordImpersonal: {
      id: 'auth/password/impersonal',
      defaultMessage: 'No name, student number, email or product name',
    },
    passwordUnguessable: {
      id: 'auth/password/unguessable',
      defaultMessage: 'Not a common or patterned password',
    },
    passwordAdvice: {
      id: 'auth/password/advice',
      defaultMessage: 'Try a few words strung together',
    },
    resetSetting: { id: 'auth/reset/setting', defaultMessage: 'Setting…' },
    resetDoneTitle: { id: 'auth/reset/done-title', defaultMessage: 'Your new password is set' },
    resetDoneBody: {
      id: 'auth/reset/done-body',
      defaultMessage: 'Sign in with your new password.',
    },
    resetExpiredTitle: {
      id: 'auth/reset/expired-title',
      defaultMessage: 'This link no longer works',
    },
    resetAgain: { id: 'auth/reset/again', defaultMessage: 'Get a new link' },

    // the card any screen opens on a name it shows
    personOpenDetail: { id: 'auth/person/open-detail', defaultMessage: 'View details' },
    personNoBusinessNo: personNoBusinessNoMessage,
    personUserType: { id: 'auth/person/user-type', defaultMessage: 'Type' },
    personStatus: { id: 'auth/person/status', defaultMessage: 'Status' },
    personActive: { id: 'auth/person/active', defaultMessage: 'Active' },
    personDisabled: { id: 'auth/person/disabled', defaultMessage: 'Disabled' },
    personPlacement: { id: 'auth/person/placement', defaultMessage: 'Where they are' },
    personRoles: { id: 'auth/person/roles', defaultMessage: 'Roles' },
    personNoRoles: { id: 'auth/person/no-roles', defaultMessage: 'No roles yet.' },
    personRoleTenantWide: { id: 'auth/person/role-tenant-wide', defaultMessage: 'everywhere' },
    personRoleScoped: { id: 'auth/person/role-scoped', defaultMessage: 'One object only' },
    personRoleSubtree,
    personRoleHere,

    // choosing people, and choosing a slice of the organization instead
    pickerUnits: { id: 'auth/picker/units', defaultMessage: 'Organization' },
    pickerNoUnits: { id: 'auth/picker/no-units', defaultMessage: 'No units you can browse.' },
    // the twistie's spoken name; the unit's own name is appended to it
    pickerExpand: { id: 'auth/picker/expand', defaultMessage: 'Fold or unfold' },
    pickerSearch: pickerSearchMessage,
    pickerAnyType: { id: 'auth/picker/any-type', defaultMessage: 'Any type' },
    pickerScopeSelf: { id: 'auth/picker/scope-self', defaultMessage: 'This unit' },
    pickerScopeSubtree: { id: 'auth/picker/scope-subtree', defaultMessage: 'And below' },
    pickerNobody: { id: 'auth/picker/nobody', defaultMessage: 'Nobody here matches.' },
    pickerAlreadyIn: { id: 'auth/picker/already-in', defaultMessage: 'Already added' },
    pickerPrevious: { id: 'auth/picker/previous', defaultMessage: 'Previous' },
    pickerNext: { id: 'auth/picker/next', defaultMessage: 'Next' },
    importUnits: { id: 'auth/picker/import-units', defaultMessage: 'Units to take people from' },
    importTypes: { id: 'auth/picker/import-types', defaultMessage: 'Kinds of person' },
    importNoTypes: { id: 'auth/picker/import-no-types', defaultMessage: 'No types available.' },
    importAllTypes: { id: 'auth/picker/import-all-types', defaultMessage: 'Select all' },
    importClearTypes: { id: 'auth/picker/import-clear-types', defaultMessage: 'Clear' },
    nodeSearch: { id: 'auth/picker/node-search', defaultMessage: 'Search units' },
    nodeKind: { id: 'auth/picker/node-kind', defaultMessage: 'Kind of unit' },
    nodeAnyKind: { id: 'auth/picker/node-any-kind', defaultMessage: 'Any kind' },
    nodeNoMatch: { id: 'auth/picker/node-no-match', defaultMessage: 'No unit matches.' },
    pickerChosen,
    pickerChosenElsewhere,
    pickerRemove,
    nodeRemove,
    methodsFailedTitle: {
      id: 'auth/login/methods-failed',
      defaultMessage: 'Could not load the sign-in methods',
    },
    methodsFailedHint: {
      id: 'auth/login/methods-failed-hint',
      defaultMessage: 'Check your connection and try again.',
    },
    noMethods: {
      id: 'auth/login/no-methods',
      defaultMessage: 'No sign-in method is available. Please contact an administrator.',
    },
    otherMethods: { id: 'auth/login/other-methods', defaultMessage: 'Other ways to sign in' },
    // the sign-in page's two groups, as the screen that arranges them says
    methodsPrimaryTitle: { id: 'auth/login-methods/primary', defaultMessage: 'Main ways in' },
    methodsPrimaryNote: {
      id: 'auth/login-methods/primary-note',
      defaultMessage: '{count} of {most}',
    },
    methodsPrimaryHint: {
      id: 'auth/login-methods/primary-hint',
      defaultMessage: 'Listed in full on the sign-in page',
    },
    methodsSecondaryTitle: { id: 'auth/login-methods/secondary', defaultMessage: 'Other ways in' },
    methodsSecondaryHint: {
      id: 'auth/login-methods/secondary-hint',
      defaultMessage: 'Shown as icons under the main ones',
    },
    methodsDropHere: { id: 'auth/login-methods/drop-here', defaultMessage: 'Drag a way in here' },
    methodsPrimaryFull: {
      id: 'auth/login-methods/primary-full',
      defaultMessage: 'Up to {most} main ways in',
    },
    methodToPrimary: {
      id: 'auth/login-methods/to-primary',
      defaultMessage: 'Move {name} to the main ways in',
    },
    methodToSecondary: {
      id: 'auth/login-methods/to-secondary',
      defaultMessage: 'Move {name} to the other ways in',
    },
    methodRecommendedBadge: { id: 'auth/login-methods/recommended', defaultMessage: 'Recommended' },
    methodShownTitle: { id: 'auth/login-methods/shown', defaultMessage: 'On the sign-in page' },
    methodShownAs: { id: 'auth/login-methods/shown-as', defaultMessage: 'Shown as' },
    methodShownPrimary: {
      id: 'auth/login-methods/shown-primary',
      defaultMessage:
        'Main way in, {position, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
    },
    methodShownSecondary: {
      id: 'auth/login-methods/shown-secondary',
      defaultMessage:
        'Other way in, {position, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
    },
    methodRecommend: { id: 'auth/login-methods/recommend', defaultMessage: 'Recommended' },
    methodRecommendHint: {
      id: 'auth/login-methods/recommend-hint',
      defaultMessage: 'Shown first in a darker style. Only a main way in can be.',
    },
    methodIconLabel: { id: 'auth/login-methods/icon', defaultMessage: 'Icon' },
    methodIconChange: { id: 'auth/login-methods/icon-change', defaultMessage: 'Change' },
    methodIconTitle: { id: 'auth/login-methods/icon-title', defaultMessage: 'Choose an icon' },
    methodIconDefault: {
      id: 'auth/login-methods/icon-default',
      defaultMessage: 'Use its kind’s icon',
    },
    methodIconUpload: { id: 'auth/login-methods/icon-upload', defaultMessage: 'Upload an image' },
    methodIconUploading: { id: 'auth/login-methods/icon-uploading', defaultMessage: 'Uploading…' },
    methodIconUploadHint: {
      id: 'auth/login-methods/icon-upload-hint',
      defaultMessage: 'PNG, JPEG or WebP up to 256 KB, or SVG up to 64 KB. Square works best',
    },
    methodIconOwn: { id: 'auth/login-methods/icon-own', defaultMessage: 'Your own image' },
    methodIconOnLight: { id: 'auth/login-methods/icon-on-light', defaultMessage: 'On light' },
    methodIconOnDark: { id: 'auth/login-methods/icon-on-dark', defaultMessage: 'On dark' },
    methodIconDarkOptional: {
      id: 'auth/login-methods/icon-dark-optional',
      defaultMessage: 'Optional. Without it, the light one is used',
    },
    methodIconDarkNeedsLight: {
      id: 'auth/login-methods/icon-dark-needs-light',
      defaultMessage: 'Upload the light one first',
    },
    methodIconRemoveDark: { id: 'auth/login-methods/icon-remove-dark', defaultMessage: 'Remove' },
    methodIconSaved: { id: 'auth/login-methods/icon-saved', defaultMessage: 'Icon changed' },
    iconNameCampus: { id: 'auth/login-icon/campus', defaultMessage: 'Campus' },
    iconNameKey: { id: 'auth/login-icon/key', defaultMessage: 'Key' },
    iconNameMail: { id: 'auth/login-icon/mail', defaultMessage: 'Mail' },
    iconNameIdCard: { id: 'auth/login-icon/id-card', defaultMessage: 'ID card' },
    iconNameShield: { id: 'auth/login-icon/shield', defaultMessage: 'Shield' },
    iconNameGlobe: { id: 'auth/login-icon/globe', defaultMessage: 'Globe' },
    iconNameGithub: { id: 'auth/login-icon/github', defaultMessage: 'GitHub' },
    iconNameGitlab: { id: 'auth/login-icon/gitlab', defaultMessage: 'GitLab' },
    iconNameMicrosoft: { id: 'auth/login-icon/microsoft', defaultMessage: 'Microsoft' },
    iconNameGoogle: { id: 'auth/login-icon/google', defaultMessage: 'Google' },
    iconNameApple: { id: 'auth/login-icon/apple', defaultMessage: 'Apple' },
    iconNameWechat: { id: 'auth/login-icon/wechat', defaultMessage: 'WeChat' },
    iconNameWecom: { id: 'auth/login-icon/wecom', defaultMessage: 'WeCom' },
    iconNameDingtalk: { id: 'auth/login-icon/dingtalk', defaultMessage: 'DingTalk' },
    iconNameFeishu: { id: 'auth/login-icon/feishu', defaultMessage: 'Feishu' },
    iconNameQq: { id: 'auth/login-icon/qq', defaultMessage: 'QQ' },
    rendererMissing: {
      id: 'auth/login/renderer-missing',
      defaultMessage: 'This sign-in method is currently unavailable',
    },
    signIn: { id: 'auth/action/sign-in', defaultMessage: 'Sign in' },
    signOut: { id: 'auth/action/sign-out', defaultMessage: 'Sign out' },
    noBusinessNo: noBusinessNoMessage,
    appearance: { id: 'auth/preference/appearance', defaultMessage: 'Appearance' },
    language: { id: 'auth/preference/language', defaultMessage: 'Language' },
    themeLight: { id: 'auth/preference/theme-light', defaultMessage: 'Light' },
    themeDark: { id: 'auth/preference/theme-dark', defaultMessage: 'Dark' },
    themeSystem: { id: 'auth/preference/theme-system', defaultMessage: 'System' },

    usersTitle: { id: 'auth/users/title', defaultMessage: 'Users' },
    usersHint: {
      id: 'auth/users/hint',
      defaultMessage: 'Maintain the roster, the types and the placements of one unit at a time.',
    },
    usersEmpty: { id: 'auth/users/empty', defaultMessage: 'No users here yet.' },
    userTypesTitle: { id: 'auth/user-types/title', defaultMessage: 'User types' },
    userTypesHint: {
      id: 'auth/user-types/hint',
      defaultMessage:
        'A user type decides how a class of people signs in and where they may belong. What they may do is decided by the roles they hold.',
    },
    userTypesEmpty: { id: 'auth/user-types/empty', defaultMessage: 'No user types yet.' },
    backToUsers: { id: 'auth/users/back', defaultMessage: 'All users' },
    profileSection: { id: 'auth/users/profile', defaultMessage: 'Profile' },
    newUser: { id: 'auth/users/new', defaultMessage: 'New user' },
    newUserHint: {
      id: 'auth/users/new-hint',
      defaultMessage: 'The user is placed on the selected organization node.',
    },
    newUserType: { id: 'auth/user-types/new', defaultMessage: 'New user type' },
    newUserTypeHint: {
      id: 'auth/user-types/new-hint',
      defaultMessage:
        'A type is created complete: without a sign-in channel nobody holding it can sign in.',
    },
    editUserType: { id: 'auth/user-types/edit', defaultMessage: 'User type configuration' },

    nameLabel: { id: 'auth/field/name', defaultMessage: 'Name' },
    codeLabel: { id: 'auth/field/code', defaultMessage: 'Code' },
    descriptionLabel: { id: 'auth/field/description', defaultMessage: 'Description' },
    userTypeLabel: { id: 'auth/field/user-type', defaultMessage: 'User type' },
    selectUserType: { id: 'auth/field/select-user-type', defaultMessage: 'Select a user type' },
    identifierLabel: { id: 'auth/field/identifier', defaultMessage: 'Sign-in name' },
    anchorLabel: { id: 'auth/users/anchor', defaultMessage: 'Unit' },
    scopeLabel: { id: 'auth/users/scope', defaultMessage: 'Include the whole subtree' },
    allowedOrgTypesLegend: {
      id: 'auth/field/allowed-org-types',
      defaultMessage: 'May be placed on these kinds of organization node',
    },
    placementTenantRoot: {
      id: 'auth/field/placement-tenant-root',
      defaultMessage: 'Fixed at the tenant root',
    },
    placementHint: {
      id: 'auth/field/placement-hint',
      defaultMessage:
        'Where this kind of person belongs. It says nothing about what they may do, which is what roles decide. Unticking a kind is refused, with the number of people, while anyone of this type belongs to a unit of that kind.',
    },
    noOptions: { id: 'auth/field/no-options', defaultMessage: 'Nothing to choose from yet.' },
    noAnchors: {
      id: 'auth/users/no-anchors',
      defaultMessage: 'You do not administer users anywhere yet.',
    },

    create: { id: 'auth/action/create', defaultMessage: 'Create' },
    save: { id: 'auth/action/save', defaultMessage: 'Save' },
    cancel: { id: 'auth/action/cancel', defaultMessage: 'Cancel' },
    delete: { id: 'auth/action/delete', defaultMessage: 'Delete' },
    enable: { id: 'auth/action/enable', defaultMessage: 'Enable' },
    disable: { id: 'auth/action/disable', defaultMessage: 'Disable' },
    loadMore: { id: 'auth/action/load-more', defaultMessage: 'Load more' },
    treeSearch: { id: 'auth/users/tree-search', defaultMessage: 'Search units' },
    emailLabel: { id: 'auth/users/email', defaultMessage: 'Email' },
    emailNone: { id: 'auth/users/email-none', defaultMessage: 'Not set' },
    emailVerified: { id: 'auth/users/email-verified', defaultMessage: 'Verified' },
    emailUnverified: { id: 'auth/users/email-unverified', defaultMessage: 'Not verified' },
    emailEditHint: { id: 'auth/users/email-edit-hint', defaultMessage: 'Notices are sent here' },
    emailSystemHint: {
      id: 'auth/users/email-system-hint',
      defaultMessage: 'The system account’s address is set when it is provisioned',
    },
    lastSignInLabel: { id: 'auth/users/last-sign-in', defaultMessage: 'Last sign-in' },
    personGone: {
      id: 'auth/person/gone',
      defaultMessage: 'Deleted, or outside what you can see',
    },
    unitsTitle: {
      id: 'auth/users/units',
      defaultMessage: 'Units',
    },
    unitsCount: {
      id: 'auth/users/units-count',
      defaultMessage: '{count} in all',
    },
    expandAll: {
      id: 'auth/users/expand-all',
      defaultMessage: 'Expand all',
    },
    foldBranch: {
      id: 'auth/users/fold-branch',
      defaultMessage: 'Expand or collapse',
    },
    rosterWithinSubtree: {
      id: 'auth/users/roster-within-subtree',
      defaultMessage:
        'With the units under it, {count, plural, =0 {nobody} one {# person} other {# people}}',
    },
    rosterWithinSelf: {
      id: 'auth/users/roster-within-self',
      defaultMessage:
        'This unit alone, {count, plural, =0 {nobody} one {# person} other {# people}}',
    },
    searchPeople: {
      id: 'auth/users/search-people',
      defaultMessage: 'Name or {businessNo}',
    },
    quickViewHint: {
      id: 'auth/users/quick-view-hint',
      defaultMessage: 'Their details, ways in and roles are changed on their own page',
    },
    grantCount: {
      id: 'auth/users/grant-count',
      defaultMessage: '{count, plural, =0 {no grants} one {# grant} other {# grants}}',
    },
    moveLabel: { id: 'auth/users/move', defaultMessage: 'Move' },
    movePick: { id: 'auth/users/move-pick', defaultMessage: 'Pick where they should stand' },
    moveAction: { id: 'auth/users/move-action', defaultMessage: 'Move here' },
    moveTarget: { id: 'auth/users/move-target', defaultMessage: 'Moving to' },
    personNameLabel: { id: 'auth/field/person-name', defaultMessage: 'Name' },
    newUserNoTypes: {
      id: 'auth/users/new-no-types',
      defaultMessage: 'No kind of person may stand at this unit, so nobody can be made here.',
    },
    newUserNoTypesGo: {
      id: 'auth/users/new-no-types-go',
      defaultMessage: 'Set where a type may stand',
    },
    moveNotManageable: { id: 'auth/users/move-not-manageable', defaultMessage: 'Not yours' },
    moveTypeRefused: {
      id: 'auth/users/move-type-refused',
      defaultMessage: 'Wrong kind of unit',
    },
    moveConfirmTitle: { id: 'auth/users/move-confirm', defaultMessage: 'Move them?' },
    moveConfirmBody: moveConfirmMessage,
    moveAlreadyHere: { id: 'auth/users/move-already-here', defaultMessage: 'Already here' },
    movePickerUnavailable: {
      id: 'auth/users/move-picker-unavailable',
      defaultMessage: 'No unit picker is installed, so nobody can be moved from here.',
    },
    editProfile: { id: 'auth/person/edit-profile', defaultMessage: 'Edit profile' },
    profileTabIdentities: { id: 'auth/person/tab-identities', defaultMessage: 'Ways in' },
    placementEmpty: {
      id: 'auth/user-detail/placement-empty',
      defaultMessage: 'Not placed in any unit yet',
    },
    lastUsed: lastUsedMessage,
    neverUsed: { id: 'auth/person/never-used', defaultMessage: 'Never used' },
    entranceDisabled: { id: 'auth/person/entrance-disabled', defaultMessage: 'Entrance disabled' },
    jumpLabel: jumpLabelMessage,
    methodNew: { id: 'auth/login-methods/new', defaultMessage: 'Add a way in' },
    methodKindPick: { id: 'auth/login-methods/kind-pick', defaultMessage: 'Choose a kind' },
    methodNameHint: {
      id: 'auth/login-methods/name-hint',
      defaultMessage: 'What people see on the sign-in page',
    },
    methodCodeHint: {
      id: 'auth/login-methods/code-hint-new',
      defaultMessage:
        'Lowercase letters, digits and hyphens. It is part of every sign-in link, so it cannot be changed later',
    },
    methodSecretStored: {
      id: 'auth/login-methods/secret-stored',
      defaultMessage: 'Saved. Type a new value to replace it',
    },
    methodSecretClear: { id: 'auth/login-methods/secret-clear', defaultMessage: 'Clear' },
    methodChoose: { id: 'auth/login-methods/choose', defaultMessage: 'Choose' },
    accountProfile: { id: 'auth/account/profile', defaultMessage: 'Profile' },
    accountLogins: { id: 'auth/account/logins', defaultMessage: 'Ways in' },
    accountLoginsEmpty: {
      id: 'auth/account/logins-empty',
      defaultMessage: 'No way in is open to you right now.',
    },
    accountNotBound: { id: 'auth/account/not-bound', defaultMessage: 'Not bound yet' },
    accountUnbind: { id: 'auth/account/unbind', defaultMessage: 'Unbind' },
    accountBind: { id: 'auth/account/bind', defaultMessage: 'Bind' },
    accountSecurity: { id: 'auth/account/security', defaultMessage: 'Security' },
    passwordSection: { id: 'auth/account/password', defaultMessage: 'Password' },
    currentPassword: { id: 'auth/account/current-password', defaultMessage: 'Current password' },
    passwordChange: { id: 'auth/account/password-change', defaultMessage: 'Change password' },
    passwordSetFirst: { id: 'auth/account/password-set', defaultMessage: 'Set password' },
    passwordIsSet: { id: 'auth/account/password-is-set', defaultMessage: 'Set' },
    passwordIsUnset: { id: 'auth/account/password-is-unset', defaultMessage: 'Not set' },
    passwordSave: { id: 'auth/account/password-save', defaultMessage: 'Save' },
    emailSetAction: { id: 'auth/account/email-set', defaultMessage: 'Add' },
    emailChangeAction: { id: 'auth/account/email-change', defaultMessage: 'Change' },
    emailSetTitle: { id: 'auth/account/email-set-title', defaultMessage: 'Add an email' },
    emailChangeTitle: { id: 'auth/account/email-change-title', defaultMessage: 'Change email' },
    passwordChanged: {
      id: 'auth/account/password-changed',
      defaultMessage: 'Password saved. Every other device was signed out.',
    },
    passwordNotOpen: {
      id: 'auth/account/password-not-open',
      defaultMessage: 'Signing in with a password is not available',
    },
    passwordNeedsEmail: {
      id: 'auth/account/password-needs-email',
      defaultMessage: 'Verify your email to set a password',
    },
    sendVerification: {
      id: 'auth/account/send-verification',
      defaultMessage: 'Send verification email',
    },
    verificationSent: {
      id: 'auth/account/verification-sent',
      defaultMessage: 'Sent. Open the link in the email.',
    },
    newEmail: { id: 'auth/account/new-email', defaultMessage: 'New email' },
    sendChange: { id: 'auth/account/send-change', defaultMessage: 'Send confirmation' },
    changeHint: {
      id: 'auth/account/change-hint',
      defaultMessage: 'The new address takes over once you open the link sent to it',
    },
    changeSent: {
      id: 'auth/account/change-sent',
      defaultMessage: 'Sent to the new address. Open the link in it to finish.',
    },
    reauthTitle: { id: 'auth/account/reauth-title', defaultMessage: 'Confirm it’s you' },
    reauthPasswordHint: {
      id: 'auth/account/reauth-password-hint',
      defaultMessage: 'Enter your current password to continue',
    },
    reauthCodeHint: {
      id: 'auth/account/reauth-code-hint',
      defaultMessage: 'A code goes to {email}',
    },
    reauthCodeSend: { id: 'auth/account/reauth-code-send', defaultMessage: 'Send code' },
    reauthCodeLabel: { id: 'auth/account/reauth-code-label', defaultMessage: 'Code' },
    reauthCodeSentHint: {
      id: 'auth/account/reauth-code-sent-hint',
      defaultMessage: 'Sent to {email}. It works for 10 minutes',
    },
    reauthCodeAgain: { id: 'auth/account/reauth-code-again', defaultMessage: 'Send again' },
    reauthSignInHint: {
      id: 'auth/account/reauth-sign-in-hint',
      defaultMessage: 'Sign in again with one of these to continue',
    },
    reauthSignInWith: {
      id: 'auth/account/reauth-sign-in-with',
      defaultMessage: 'Sign in with {name}',
    },
    reauthUnavailable: {
      id: 'auth/account/reauth-unavailable',
      defaultMessage: 'Ask an administrator to make this change',
    },
    reauthContinue: { id: 'auth/account/reauth-continue', defaultMessage: 'Continue' },
    resetTitle: { id: 'auth/reset/title', defaultMessage: 'Reset password' },
    resetAskHint: {
      id: 'auth/reset/ask-hint',
      defaultMessage:
        'Enter your account’s email. If it is verified, a link to set a new password is sent to it',
    },
    resetAskSubmit: { id: 'auth/reset/ask-submit', defaultMessage: 'Send link' },
    resetNewPassword: { id: 'auth/reset/new-password', defaultMessage: 'New password' },
    resetConfirmPassword: {
      id: 'auth/reset/confirm-password',
      defaultMessage: 'Repeat the new password',
    },
    resetSubmit: { id: 'auth/reset/submit', defaultMessage: 'Set password' },
    passwordMismatch: { id: 'auth/reset/mismatch', defaultMessage: 'The two passwords differ.' },
    toSignIn: { id: 'auth/reset/to-sign-in', defaultMessage: 'Go to sign in' },
    confirmTitle: { id: 'auth/confirm/title', defaultMessage: 'Confirm email' },
    confirmVerified: { id: 'auth/confirm/verified', defaultMessage: 'Your email is verified' },
    confirmChanged: {
      id: 'auth/confirm/changed',
      defaultMessage: 'Your account now uses this email',
    },
    confirmMissing: {
      id: 'auth/confirm/missing',
      defaultMessage: 'This link is incomplete. Open it from the email again',
    },
    toAccount: { id: 'auth/confirm/to-account', defaultMessage: 'Go to my account' },
    // the reader's sessions, and the record of their sign-ins
    sessionsTitle: { id: 'auth/sessions/title', defaultMessage: 'Signed in now' },
    sessionCurrent: { id: 'auth/sessions/current', defaultMessage: 'This session' },
    sessionActive: sessionActiveMessage,
    sessionEnd: { id: 'auth/sessions/end', defaultMessage: 'Sign out' },
    sessionEnded: { id: 'auth/sessions/end-done', defaultMessage: 'Signed out of that session' },
    sessionsEndOthers: {
      id: 'auth/sessions/end-others',
      defaultMessage: 'Sign out of every other session',
    },
    sessionsEndOthersTitle: {
      id: 'auth/sessions/end-others-title',
      defaultMessage: 'Sign out of every other session?',
    },
    sessionsEndOthersBody: {
      id: 'auth/sessions/end-others-body',
      defaultMessage: 'They will have to sign in again',
    },
    sessionsEnded: sessionsEndedMessage,
    sessionsActivity: { id: 'auth/sessions/activity', defaultMessage: 'View sign-ins' },
    unknownDevice: { id: 'auth/sessions/unknown-device', defaultMessage: 'Unknown browser' },
    entranceGone: { id: 'auth/sessions/entrance-gone', defaultMessage: 'A way in since removed' },
    showMore: { id: 'auth/sessions/more', defaultMessage: 'Show more' },
    activityTitle: { id: 'auth/activity/title', defaultMessage: 'Security activity' },
    activitySignIns: { id: 'auth/activity/sign-ins', defaultMessage: 'Sign-ins' },
    activityChanges: { id: 'auth/activity/changes', defaultMessage: 'Account changes' },
    activityPeriod: { id: 'auth/activity/period', defaultMessage: 'Any date' },
    recordsAll: { id: 'auth/activity/all', defaultMessage: 'View all' },
    recordsSummary: recordsSummaryMessage,
    changesEmpty: { id: 'auth/activity/changes-empty', defaultMessage: 'No changes yet' },
    changeBySelf: { id: 'auth/activity/by-self', defaultMessage: 'By you' },
    changeByOther: { id: 'auth/activity/by-other', defaultMessage: 'By an administrator' },
    signInsEmpty: { id: 'auth/sign-ins/empty', defaultMessage: 'No sign-ins yet' },
    signInsFilter: { id: 'auth/sign-ins/filter', defaultMessage: 'Outcome' },
    signInsFilterAll: { id: 'auth/sign-ins/filter-all', defaultMessage: 'All' },
    signInsFilterSucceeded: { id: 'auth/sign-ins/filter-succeeded', defaultMessage: 'Succeeded' },
    signInsFilterRefused: { id: 'auth/sign-ins/filter-refused', defaultMessage: 'Refused' },
    signInSucceeded: { id: 'auth/sign-ins/succeeded', defaultMessage: 'Signed in' },
    signInRefused: { id: 'auth/sign-ins/refused', defaultMessage: 'Refused' },
    signInThisSession: { id: 'auth/sign-ins/this-session', defaultMessage: 'This session' },
    accountUnbindTitle: methodNamed('auth/account/unbind-title', 'Unbind {name}?'),
    accountUnbindBody: {
      id: 'auth/account/unbind-body',
      defaultMessage:
        'You will no longer sign in this way, and every session signed in through it ends.{current, select, yes { You signed in this way, so you will be signed out now.} other {}}',
    },
    methodAdvanced: { id: 'auth/login-methods/advanced', defaultMessage: 'Advanced settings' },
    methodSecretClearLabel: methodSecretClearLabelMessage,
    methodMissing: methodMissingMessage,
    methodDriverMissing: {
      id: 'auth/login-methods/driver-missing',
      defaultMessage: 'No installed plugin provides this kind',
    },
    methodEnableBlocked: {
      id: 'auth/login-methods/enable-blocked',
      defaultMessage: 'Fill in every required setting to put it in service',
    },
    methodSetupShort: { id: 'auth/login-methods/setup-short', defaultMessage: 'Not set up' },
    methodOriginMissing: {
      id: 'auth/login-methods/origin-missing',
      defaultMessage: 'The address this deployment is reached at',
    },
    methodCallback: { id: 'auth/login-methods/callback', defaultMessage: 'Callback address' },
    methodCallbackHint: {
      id: 'auth/login-methods/callback-hint',
      defaultMessage: 'What the other system has to be told to send people back to',
    },
    methodDelete: { id: 'auth/login-methods/delete', defaultMessage: 'Delete' },
    methodCallbackCopy: {
      id: 'auth/login-methods/callback-copy',
      defaultMessage: 'Copy the callback address',
    },
    copied: { id: 'auth/common/copied', defaultMessage: 'Copied' },
    copyFailed: {
      id: 'auth/common/copy-failed',
      defaultMessage: 'Could not copy; select it and copy by hand',
    },
    methodDeleteSystem: {
      id: 'auth/login-methods/delete-system',
      defaultMessage: 'Built into the platform; it can be taken out of service but not deleted',
    },
    methodDeleteTitle: methodNamed('auth/login-methods/delete-title', 'Delete {name}?'),
    methodDeleteBody: methodDeleteBodyMessage,
    methodDetails: { id: 'auth/login-methods/details', defaultMessage: 'Settings' },
    methodOrderHint: {
      id: 'auth/login-methods/order-hint',
      defaultMessage: 'Drag it in the list to move it',
    },
    methodMove: methodMoveMessage,
    methodMoveUp: methodMoveUpMessage,
    methodMoveDown: methodMoveDownMessage,
    methodDisableTitle: methodNamed(
      'auth/login-methods/disable-title',
      'Take {name} out of service?',
    ),
    methodEnableTitle: methodNamed('auth/login-methods/enable-title', 'Put {name} into service?'),
    methodDisableBody: {
      id: 'auth/login-methods/disable-body',
      defaultMessage:
        'Nobody can sign in through it from then on. People already signed in stay signed in.',
    },
    methodEnableBody: {
      id: 'auth/login-methods/enable-body',
      defaultMessage: 'It appears on the sign-in page at once, for the user types it admits.',
    },
    personRolesConfined: {
      id: 'auth/person/roles-confined',
      defaultMessage: 'Confined to one object',
    },
    unitChange: { id: 'auth/users/unit-change', defaultMessage: 'Change' },
    typeMembersTitle: { id: 'auth/user-types/members', defaultMessage: 'People of this type' },
    jumpOpen: { id: 'auth/users/jump-open', defaultMessage: 'Find a person' },
    jumpHint: jumpHintMessage,
    jumpFound: jumpFoundMessage,
    jumpNone: { id: 'auth/users/jump-none', defaultMessage: 'Nobody matches' },
    lookAt: lookAtMessage,
    pageSummary: pageSummaryMessage,
    pagerLabel: { id: 'auth/users/pager', defaultMessage: 'Pages' },
    resizeTree: { id: 'auth/users/resize-tree', defaultMessage: 'Resize the unit list' },
    openInStructure: {
      id: 'auth/users/open-in-structure',
      defaultMessage: 'Open in the organization tree',
    },
    pickUnit: { id: 'auth/users/pick-unit', defaultMessage: 'Show the people of' },
    treeMenu: { id: 'auth/users/tree-menu', defaultMessage: 'Unit list options' },
    collapseAll: { id: 'auth/users/collapse-all', defaultMessage: 'Collapse all' },
    nodeUsagePeople: { id: 'auth/node-usage/people', defaultMessage: 'People standing here' },
    identitiesSection: { id: 'auth/person/identities-section', defaultMessage: 'Ways in' },
    columnAccount: { id: 'auth/person/column-account', defaultMessage: 'Account' },
    columnLastUsed: { id: 'auth/person/column-last-used', defaultMessage: 'Last sign-in' },
    entranceUnbound: { id: 'auth/person/entrance-unbound', defaultMessage: 'Not bound' },
    entranceNotAdmitted: {
      id: 'auth/person/entrance-not-admitted',
      defaultMessage: 'Not open to their user type',
    },
    entranceSelf: {
      id: 'auth/person/entrance-self',
      defaultMessage: 'Bound by the person themselves',
    },
    byBusinessNo: byBusinessNoMessage,
    businessNoMissing: businessNoMissingMessage,
    emailMissing: {
      id: 'auth/person/email-missing',
      defaultMessage: 'No email yet; add one in the profile first',
    },
    fromEmail: { id: 'auth/person/from-email', defaultMessage: 'the person’s email' },
    credentialSet: { id: 'auth/person/credential-set', defaultMessage: 'Password set' },
    credentialUnset: { id: 'auth/person/credential-unset', defaultMessage: 'No password yet' },
    driverMissing: {
      id: 'auth/person/driver-missing',
      defaultMessage: 'Not available in this deployment',
    },
    passwordSet: { id: 'auth/person/password-set', defaultMessage: 'Set password' },
    passwordReset: { id: 'auth/person/password-reset', defaultMessage: 'Reset password' },
    identityRevoke: { id: 'auth/person/identity-revoke', defaultMessage: 'Withdraw' },
    passwordDialogTitle: passwordDialogTitleMessage,
    identityResetBody: {
      id: 'auth/person/identity-reset-body',
      defaultMessage: 'Saving signs them out everywhere.',
    },
    identityRevokeTitle: {
      id: 'auth/person/identity-revoke-title',
      defaultMessage: 'Withdraw this way in?',
    },
    identityRevokeBody: {
      id: 'auth/person/identity-revoke-body',
      defaultMessage: 'They can no longer sign in this way, and are signed out everywhere.',
    },
    manageWaysIn: { id: 'auth/person/manage-ways-in', defaultMessage: 'Manage entrances' },
    manageRoles: { id: 'auth/person/manage-roles', defaultMessage: 'Manage roles' },
    rolesLabel: { id: 'auth/users/roles', defaultMessage: 'Roles' },
    rolesNone: { id: 'auth/users/roles-none', defaultMessage: 'None' },
    treeSearchEmpty: {
      id: 'auth/users/tree-search-empty',
      defaultMessage: 'No unit matches the search.',
    },
    scopeSelf: { id: 'auth/users/scope-self', defaultMessage: 'This unit' },
    scopeSubtree: { id: 'auth/users/scope-subtree', defaultMessage: 'With children' },
    typeFilterAll: { id: 'auth/users/type-filter-all', defaultMessage: 'All types' },
    typeFilterLabel: { id: 'auth/users/type-filter', defaultMessage: 'User type' },
    columnName: { id: 'auth/users/column-name', defaultMessage: 'Name' },
    columnType: { id: 'auth/users/column-type', defaultMessage: 'Type' },
    columnUnit: { id: 'auth/users/column-unit', defaultMessage: 'Unit' },
    columnStatus: { id: 'auth/users/column-status', defaultMessage: 'Status' },
    statusActive: { id: 'auth/users/status-active', defaultMessage: 'Active' },
    loadedCount: {
      id: 'auth/users/loaded-count',
      defaultMessage: '{count, plural, one {# person listed} other {# people listed}}',
    },
    transfer: { id: 'auth/action/transfer', defaultMessage: 'Transfer' },
    moreActions: { id: 'auth/action/more', defaultMessage: 'More' },
    // Which set of people the roster is showing. Said as the answer rather
    // than as a switch: a press that reads "show removed people" says what
    // it will do, never what it has done, so nobody can tell from it which
    // list they are looking at.
    // Which people the roster is showing, by the standing they are in. The
    // filter used to say what a press would do to the list, which reads the
    // same whichever list you are looking at.
    rosterStandingLabel: { id: 'auth/users/standing-filter', defaultMessage: 'Standing' },
    rosterStandingActive: { id: 'auth/users/standing-active', defaultMessage: 'In good standing' },
    rosterStandingDisabled: { id: 'auth/users/standing-disabled', defaultMessage: 'Suspended' },
    rosterStandingAny: { id: 'auth/users/standing-any', defaultMessage: 'Any standing' },
    saved: { id: 'auth/feedback/saved', defaultMessage: 'Saved.' },
    systemBadge: { id: 'auth/badge/system', defaultMessage: 'system' },
    disabledBadge: { id: 'auth/badge/disabled', defaultMessage: 'disabled' },
    deleteAction: { id: 'auth/action/delete-user', defaultMessage: 'Delete' },
    confirmUserDeleteTitle: {
      id: 'auth/confirm/user-delete-title',
      defaultMessage: 'Delete this user?',
    },
    confirmUserDeleteBody: {
      id: 'auth/confirm/user-delete-body',
      defaultMessage:
        'Their roles, sign-in accounts and sessions end with them, and they cannot be brought back. Past records keep their name.',
    },
    confirmDeleteTitle: { id: 'auth/confirm/delete-title', defaultMessage: 'Delete permanently?' },
    confirmDeleteBody: { id: 'auth/confirm/delete-body', defaultMessage: 'This cannot be undone.' },
    confirmDisableTitle: { id: 'auth/confirm/disable-title', defaultMessage: 'Disable this user?' },
    confirmDisableBody: {
      id: 'auth/confirm/disable-body',
      defaultMessage: 'Their sessions end immediately.',
    },
    rename: { id: 'auth/action/rename', defaultMessage: 'Rename' },
    statusDisabled: { id: 'auth/state/disabled', defaultMessage: 'Disabled' },
    discard: { id: 'auth/action/discard', defaultMessage: 'Discard' },
    unsaved: { id: 'auth/state/unsaved', defaultMessage: 'Unsaved changes' },
    placementLegend: { id: 'auth/user-types/placement-legend', defaultMessage: 'May belong to' },
    placementAnywhere: { id: 'auth/user-types/placement-anywhere', defaultMessage: 'Anywhere' },
    placementListed: {
      id: 'auth/user-types/placement-listed',
      defaultMessage: 'Only these kinds',
    },
    signInLabel: { id: 'auth/user-types/sign-in', defaultMessage: 'Ways in' },
    signInNone: {
      id: 'auth/user-types/sign-in-none',
      defaultMessage: 'No entrance admits this type yet, so nobody holding it can sign in.',
    },
    signInSettings: { id: 'auth/user-types/sign-in-settings', defaultMessage: 'Set up' },
    openRolesLabel: { id: 'auth/user-types/open-roles', defaultMessage: 'Roles open to it' },
    openRolesNone: {
      id: 'auth/user-types/open-roles-none',
      defaultMessage: 'No role admits this type yet.',
    },
    lifecycleLabel: { id: 'auth/user-types/lifecycle', defaultMessage: 'Disable and delete' },
    blockerInUse: inUseBlockerMessage,
    blockerSystem: {
      id: 'auth/user-types/blocker-system',
      defaultMessage: 'A preset type stays for as long as the platform provisions it.',
    },
    blockerClear: {
      id: 'auth/user-types/blocker-clear',
      defaultMessage: 'Nothing holds this type back.',
    },
    loginMethodsTitle: { id: 'auth/login-methods/title', defaultMessage: 'Ways in' },
    loginMethodsHint: {
      id: 'auth/login-methods/hint',
      defaultMessage:
        'Each entrance says which user types may sign in through it, and the list order is the order of the sign-in page.',
    },
    loginMethodsEmpty: {
      id: 'auth/login-methods/empty',
      defaultMessage: 'No entrance is configured yet.',
    },
    audienceLegend: { id: 'auth/login-methods/audience', defaultMessage: 'May sign in' },
    audienceAnyone: { id: 'auth/login-methods/audience-anyone', defaultMessage: 'Anyone' },
    audienceListed: {
      id: 'auth/login-methods/audience-listed',
      defaultMessage: 'Only these types',
    },
    audienceNobody: {
      id: 'auth/login-methods/audience-nobody',
      defaultMessage: 'Nobody can sign in through it while the list is empty.',
    },
    providerKindLabel: { id: 'auth/login-methods/kind', defaultMessage: 'Kind' },
    providerCodeLabel: { id: 'auth/login-methods/code', defaultMessage: 'Address' },
    providerCodeHint: {
      id: 'auth/login-methods/code-hint',
      defaultMessage: 'Fixed once created.',
    },
    providerOrderLabel: { id: 'auth/login-methods/order', defaultMessage: 'Sign-in page order' },
    audienceSummary: audienceSummaryMessage,
    audienceEveryone: {
      id: 'auth/login-methods/audience-everyone',
      defaultMessage: 'Open to every user type',
    },
    userCount: userCountMessage,
    columnUsers: { id: 'auth/user-types/column-users', defaultMessage: 'Users' },
    unknownWord: { id: 'auth/word/unknown', defaultMessage: 'Not visible to you' },
    noneWord: { id: 'auth/word/none', defaultMessage: 'None' },
    typeEnabled: { id: 'auth/state/enabled', defaultMessage: 'Enabled' },
    signInNoneShort: {
      id: 'auth/user-types/sign-in-none-short',
      defaultMessage: 'No entrance admits it',
    },
    backToUserTypes: { id: 'auth/user-types/back', defaultMessage: 'Back to user types' },
    userTypeGone: {
      id: 'auth/user-types/gone',
      defaultMessage: 'This user type no longer exists.',
    },
    roleCount: roleCountMessage,
    signInOwnerHint: {
      id: 'auth/user-types/sign-in-owner-hint',
      defaultMessage: 'Each way in decides whom it admits. Change it on the ways in page.',
    },
    openRolesOwnerHint: {
      id: 'auth/user-types/open-roles-owner-hint',
      defaultMessage:
        'Each role decides which user types may hold it. Change it on the roles page.',
    },
    roleKindTenant: { id: 'auth/user-types/role-kind-tenant', defaultMessage: 'Tenant-wide' },
    roleKindOrg: { id: 'auth/user-types/role-kind-org', defaultMessage: 'At a unit' },
    providerPosition: providerPositionMessage,
    peopleTally: peopleTallyMessage,
    audienceListedHint: {
      id: 'auth/login-methods/audience-listed-hint',
      defaultMessage: 'Only people of the ticked types may sign in through it.',
    },
  },
  errors: defineErrorTranslations<ErrorsByCode<typeof authErrors & typeof signInFailures>>()({
    // what the sign-in page says when a redirect sign-in comes back without one
    AUTH_METHOD_UNAVAILABLE: {
      id: 'auth/error/method-unavailable',
      defaultMessage: 'This sign-in method is not available right now. Choose another one.',
    },
    AUTH_FLOW_REJECTED: {
      id: 'auth/error/flow-rejected',
      defaultMessage: 'That sign-in expired or was already used. Start again.',
    },
    AUTH_EXTERNAL_ACCOUNT_UNBOUND: {
      id: 'auth/error/external-account-unbound',
      defaultMessage:
        'No one here has bound that account. Sign in another way, then bind it under Me → Ways in.',
    },
    AUTH_BINDING_SUBJECT_TAKEN: {
      id: 'auth/error/binding-subject-taken',
      defaultMessage: 'That account is already bound to somebody else.',
    },
    AUTH_BINDING_ALREADY_BOUND: {
      id: 'auth/error/binding-already-bound',
      defaultMessage: 'You already have an account bound here. Unbind it first to bind another.',
    },
    AUTH_PERSON_NOT_FOUND: {
      id: 'auth/error/person-not-found',
      defaultMessage:
        'Your identity was confirmed, but no account here matches it. Contact an administrator.',
    },
    USER_TYPE_NOT_FOUND: {
      id: 'auth/error/user-type-not-found',
      defaultMessage: 'User type not found.',
    },
    USER_TYPE_CONFLICT: {
      id: 'auth/error/user-type-conflict',
      defaultMessage: 'A user type with that code or name already exists.',
    },
    USER_TYPE_IS_SYSTEM: {
      id: 'auth/error/user-type-is-system',
      defaultMessage: 'System user types cannot be changed this way.',
    },
    USER_TYPE_IN_USE: {
      message: userTypeInUseMessage,
      values: (data) => ({ userCount: data.userCount }),
    },
    USER_TYPE_LAST_FOR_ROLE: {
      message: userTypeLastForRoleMessage,
      values: (data) => ({ roleCount: data.roleCount }),
    },
    USER_TYPE_REFERENCED: {
      id: 'auth/error/user-type-referenced',
      defaultMessage: 'Past records still name this user type, so it can only be disabled.',
    },
    RECOVERY_CHANNEL_REQUIRED: {
      id: 'auth/error/recovery-channel-required',
      defaultMessage: 'The system account must keep a working password sign-in.',
    },
    USER_TYPE_PLACEMENT_NOT_ALLOWED: {
      id: 'auth/error/user-type-placement-not-allowed',
      defaultMessage: 'That kind of person may not be placed on this kind of node.',
    },
    USER_TYPE_PLACEMENT_IN_USE: {
      message: placementInUseMessage,
      values: (data) => ({ userCount: data.userCount }),
    },
    USER_TYPE_VERSION_CONFLICT: {
      id: 'auth/error/user-type-version-conflict',
      defaultMessage: 'The user type changed since you opened it. Reload and try again.',
    },
    AUTH_PROVIDER_NOT_FOUND: {
      id: 'auth/error/provider-not-found',
      defaultMessage: 'This login method no longer exists.',
    },
    AUTH_PROVIDER_ARRANGEMENT_INVALID: {
      id: 'auth/error/provider-arrangement-invalid',
      defaultMessage:
        'Up to three login methods can be main ones, and only a main one can be recommended.',
    },
    AUTH_PROVIDER_ICON_INVALID: {
      message: iconInvalidMessage,
      values: (data) => ({ reason: selectKey(data.reason) }),
    },
    AUTH_LOGIN_METHOD_ICON_UNAVAILABLE: {
      id: 'auth/error/login-method-icon-unavailable',
      defaultMessage: 'This icon is no longer available.',
    },
    AUTH_PROVIDER_VERSION_CONFLICT: {
      id: 'auth/error/provider-version-conflict',
      defaultMessage: 'The login method changed since you opened it. Reload and try again.',
    },
    USER_TYPE_ORG_TYPE_NOT_FOUND: {
      id: 'auth/error/user-type-org-type-not-found',
      defaultMessage: 'Organization type not found.',
    },
    USER_TYPE_DISABLED: {
      id: 'auth/error/user-type-disabled',
      defaultMessage: 'That user type is disabled.',
    },
    USER_NOT_FOUND: { id: 'auth/error/user-not-found', defaultMessage: 'User not found.' },
    USER_CONFLICT: {
      id: 'auth/error/user-conflict',
      defaultMessage: 'That identifier is already in use.',
    },
    USER_PLACEMENT_NOT_FOUND: {
      id: 'auth/error/user-placement-not-found',
      defaultMessage: 'That organization node does not exist in this tenant.',
    },
    GRANT_INCOMPATIBLE: {
      message: grantIncompatibleMessage,
      values: (data) => ({ grantCount: data.grantCount }),
    },
    SYSTEM_ACCOUNT_PROTECTED: {
      id: 'auth/error/system-account-protected',
      defaultMessage:
        'The system account is how this tenant recovers itself, so its type, status and placement are fixed.',
    },
    USER_VERSION_CONFLICT: {
      id: 'auth/error/user-version-conflict',
      defaultMessage: 'This person changed while the page was open. Reload and try again.',
    },
    USER_EMAIL_CONFLICT: {
      id: 'auth/error/user-email-conflict',
      defaultMessage: 'Somebody else here already has this email address.',
    },
    AUTH_PROVIDER_CONFLICT: {
      id: 'auth/error/provider-conflict',
      defaultMessage: 'Another way in already answers at that address.',
    },
    AUTH_PROVIDER_KIND_UNAVAILABLE: {
      id: 'auth/error/provider-kind-unavailable',
      defaultMessage: 'Ways in of this kind cannot be added here.',
    },
    AUTH_PROVIDER_CONFIG_INVALID: {
      id: 'auth/error/provider-config-invalid',
      defaultMessage: 'One of the settings for this kind of way in is not valid.',
    },
    AUTH_PROVIDER_CONFIG_INCOMPLETE: {
      id: 'auth/error/provider-config-incomplete',
      defaultMessage: 'A way in cannot be in service while a required setting is missing.',
    },
    AUTH_PROVIDER_IS_SYSTEM: {
      id: 'auth/error/provider-is-system',
      defaultMessage: 'The built-in password sign-in cannot be deleted.',
    },
    AUTH_PROVIDER_IDENTITY_NAMESPACE_IN_USE: {
      id: 'auth/error/provider-identity-namespace-in-use',
      defaultMessage:
        'Accounts have been bound through this way in, so that setting can no longer change.',
    },
    AUTH_BINDING_UNSUPPORTED: {
      id: 'auth/error/binding-unsupported',
      defaultMessage: "Nothing of this kind can be set on somebody else's behalf.",
    },
    AUTH_BINDING_AUDIENCE_EXCLUDED: {
      id: 'auth/error/binding-audience-excluded',
      defaultMessage: 'This way in does not admit their user type, so it could not be used.',
    },
    AUTH_BINDING_CREDENTIAL_INVALID: {
      id: 'auth/error/binding-credential-invalid',
      defaultMessage: 'The password does not meet the requirements.',
    },
    AUTH_BINDING_USER_FIELD_MISSING: {
      id: 'auth/error/binding-user-field-missing',
      defaultMessage:
        '{field, select, email {Add their email in the profile first.} other {Add their person identifier in the profile first.}}',
    },
    AUTH_CHALLENGE_INVALID: {
      id: 'auth/error/challenge-invalid',
      defaultMessage: 'That link has expired or was already used. Ask for a new one.',
    },
    AUTH_PASSWORD_INCORRECT: {
      id: 'auth/error/password-incorrect',
      defaultMessage: 'The current password is not right.',
    },
    AUTH_EMAIL_UNVERIFIED: {
      id: 'auth/error/email-unverified',
      defaultMessage: 'Verify your email first; then you can set a password.',
    },
    AUTH_EMAIL_MISSING: {
      id: 'auth/error/email-missing',
      defaultMessage: 'There is no email on your account to verify.',
    },
    AUTH_PASSWORD_UNAVAILABLE: {
      id: 'auth/error/password-unavailable',
      defaultMessage: 'Signing in with a password is not open to you.',
    },
    AUTH_SESSION_NOT_FOUND: {
      id: 'auth/error/session-not-found',
      defaultMessage: 'That device is already signed out.',
    },
    AUTH_MAIL_NOT_SENT: {
      id: 'auth/error/mail-not-sent',
      defaultMessage: 'The email could not be sent. Try again later.',
    },
    AUTH_LAST_WAY_IN: {
      id: 'auth/error/last-way-in',
      defaultMessage: 'Without it you could not sign in at all. Bind another way in first.',
    },
    AUTH_DEMO_ACCOUNT_LOCKED: {
      id: 'auth/error/demo-account-locked',
      defaultMessage: 'This is a shared demo account. Its sign-in details cannot be changed.',
    },
    AUTH_BINDING_NOT_FOUND: {
      id: 'auth/error/binding-not-found',
      defaultMessage: 'There is nothing bound here to withdraw.',
    },
    AUTH_REAUTHENTICATION_REQUIRED: {
      id: 'auth/error/reauthentication-required',
      defaultMessage: 'Confirm it’s you first.',
    },
    AUTH_REAUTHENTICATION_CODE_INVALID: {
      id: 'auth/error/reauthentication-code-invalid',
      defaultMessage: 'That code is not right, or it has expired.',
    },
    AUTH_REAUTHENTICATION_METHOD_UNAVAILABLE: {
      id: 'auth/error/reauthentication-method-unavailable',
      defaultMessage: 'Your account confirms it’s you another way. Reload and try again.',
    },
  }),
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const authMessages = i18n.messages
export const iamMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
