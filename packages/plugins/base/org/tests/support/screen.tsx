import { renderScreen as render } from '@qualy/testkit/browser'
import { catalogs as orgCatalogs, errorMessages as orgErrors } from '../../src/client/i18n.ts'
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

export const catalogs = [orgCatalogs]
export const errorMessages = {
  ...orgErrors,
}

export {
  addressNow,
  apiError,
  emptyManifest,
  fakeClient,
  type FakeClient,
  type FakeManifest,
} from '@qualy/testkit/browser'

export const renderScreen = (
  options: Omit<Parameters<typeof render>[0], 'catalogs' | 'errorMessages'>,
) => render({ ...options, catalogs, errorMessages })
