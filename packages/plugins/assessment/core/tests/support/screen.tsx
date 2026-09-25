import { Effect } from 'effect'
import { renderScreen as render } from '@qualy/testkit/browser'
import {
  catalogs as assessmentCatalogs,
  errorMessages as assessmentErrors,
} from '../../src/client/i18n.ts'
import {
  catalogs as formulaCatalogs,
  errorMessages as formulaErrors,
} from '@qualy/plugin-assessment-formula/client/i18n'
import {
  catalogs as authCatalogs,
  errorMessages as authErrors,
} from '@qualy/plugin-auth/client/i18n'
import {
  catalogs as layoutCatalogs,
  errorMessages as layoutErrors,
} from '@qualy/plugin-layout-default/client/i18n'
// the host's stylesheet, because a screen asserted unstyled is a screen
// nobody sees; it is the product's one stylesheet wherever a screen renders
import '../../../../../../apps/web/src/app.css'

// This package's own use of the testkit.
//
// The catalogs are named here rather than taken from the generated
// aggregate: these tests render this plugin's screens, and the copy they
// assert is this plugin's own - plus, where one of its screens renders a
// neighbour's contribution, that neighbour's. Reaching for
// `virtual:qualy/plugins` instead would make every one of these a
// whole-composition test, and a plugin outside this repository could not
// write one at all.

export const catalogs = [assessmentCatalogs, formulaCatalogs, authCatalogs, layoutCatalogs]
export const errorMessages = {
  ...assessmentErrors,
  ...formulaErrors,
  ...authErrors,
  ...layoutErrors,
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

export const renderScreen = (
  options: Omit<Parameters<typeof render>[0], 'catalogs' | 'errorMessages'>,
) =>
  render({
    ...options,
    // the shell's own read of who is signed in, which a few screens share
    client: {
      ...options.client,
      auth: { getSession: () => Effect.succeed(signedIn), ...options.client['auth'] },
    },
    catalogs,
    errorMessages,
  })
