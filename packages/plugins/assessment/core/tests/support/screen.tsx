import { Effect } from 'effect'
import { renderScreen as render, withDocumentContext } from '@qualy/testkit/browser'
import { errorMessages as assessmentErrors } from '../../src/client/i18n.ts'
import { errorMessages as formulaErrors } from '@qualy/plugin-assessment-formula/client/i18n'
import { errorMessages as authErrors } from '@qualy/plugin-auth/client/i18n'
// the host's stylesheet, because a screen asserted unstyled is a screen
// nobody sees; it is the product's one stylesheet wherever a screen renders
import '../../../../../../apps/web/src/app.css'

// This package's own use of the testkit.
//
// What is said by code - api failures by code - is
// named here rather than taken from the generated aggregate: these tests
// render this plugin's screens, and what they meet is this plugin's own -
// plus, where one of its screens renders a neighbour's contribution, that
// neighbour's. Reaching for
// `virtual:qualy/plugins` instead would make every one of these a
// whole-composition test, and a plugin outside this repository could not
// write one at all.

export const errorMessages = {
  ...assessmentErrors,
  ...formulaErrors,
  ...authErrors,
}

export {
  addressNow,
  apiError,
  emptyManifest,
  fakeClient,
  type FakeClient,
  type FakeManifest,
} from '@qualy/testkit/browser'

/** who these screens are read by, unless a test says otherwise */
export const READER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const signedIn = {
  user: {
    id: READER_ID,
    displayName: '李老师',
    businessNo: null,
    userType: { id: 'type-staff', code: 'staff', name: '教职工' },
    primaryOrgNode: {
      id: 'node-root',
      name: '示例大学',
      orgType: { id: 'org-school', name: '学校' },
      lineage: [],
    },
    tenant: { id: 'tenant-demo', slug: 'demo', name: '示例大学' },
  },
}

/** the tenant's words settings gives every page, as a tenant that never renamed them has them */
const termsIn = (locale: 'zh-CN' | 'en-US') => ({
  'settings/terms': {
    'auth/business-number': locale === 'en-US' ? 'Student or staff ID' : '学工号',
  },
})

export const renderScreen = (options: Omit<Parameters<typeof render>[0], 'errorMessages'>) =>
  render({
    ...options,
    // the shell's own read of who is signed in, which a few screens share
    client: withDocumentContext(
      {
        ...options.client,
        auth: { getSession: () => Effect.succeed(signedIn), ...options.client['auth'] },
      },
      termsIn(options.locale ?? 'zh-CN'),
    ),
    errorMessages,
  })
