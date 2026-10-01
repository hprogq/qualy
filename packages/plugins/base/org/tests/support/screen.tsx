import { renderScreen as render } from '@qualy/testkit/browser'
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

export {
  addressNow,
  apiError,
  emptyManifest,
  fakeClient,
  type FakeClient,
  type FakeManifest,
} from '@qualy/testkit/browser'

export const renderScreen = (options: Parameters<typeof render>[0]) => render({ ...options })
