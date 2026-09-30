import { renderScreen as render } from '@qualy/testkit/browser'
import { wireMessages as rbacWire, errorMessages as rbacErrors } from '../../src/client/i18n.ts'
// the host's stylesheet, because a screen asserted unstyled is a screen
// nobody sees; it is the product's one stylesheet wherever a screen renders
import '../../../../../../apps/web/src/app.css'

// This package's own use of the testkit: this plugin's catalogs and nobody
// else's, so a test here is a test of this plugin's screens.

export const wireMessages = { ...rbacWire }
export const errorMessages = { ...rbacErrors }

export {
  apiError,
  emptyManifest,
  fakeClient,
  type FakeClient,
  type FakeManifest,
} from '@qualy/testkit/browser'

export const renderScreen = (
  options: Omit<Parameters<typeof render>[0], 'wireMessages' | 'errorMessages'>,
) => render({ ...options, wireMessages, errorMessages })
