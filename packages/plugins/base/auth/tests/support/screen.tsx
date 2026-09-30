import { renderScreen as render, withDocumentContext } from '@qualy/testkit/browser'
import { errorMessages as authErrors } from '../../src/client/i18n.ts'
import { errorMessages as authLocalErrors } from '@qualy/plugin-auth-local/client/i18n'
import { errorMessages as captchaErrors } from '@qualy/plugin-captcha/client/i18n'
import { errorMessages as rbacErrors } from '@qualy/plugin-rbac/client/i18n'
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
  ...authErrors,
  ...authLocalErrors,
  ...captchaErrors,
  ...rbacErrors,
}

export {
  addressNow,
  apiError,
  emptyManifest,
  fakeClient,
  type FakeClient,
  type FakeManifest,
} from '@qualy/testkit/browser'

/** the tenant's words settings gives every page, as a tenant that never renamed them has them */
const termsIn = (locale: 'zh-CN' | 'en-US') => ({
  'settings/terms': {
    'auth/business-number': locale === 'en-US' ? 'Student or staff ID' : '学工号',
  },
})

export const renderScreen = (options: Omit<Parameters<typeof render>[0], 'errorMessages'>) =>
  render({
    ...options,
    client: withDocumentContext(options.client, termsIn(options.locale ?? 'zh-CN')),
    errorMessages,
  })
