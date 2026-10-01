import { renderScreen as render } from '@qualy/testkit/browser'
// the host's stylesheet, because a screen asserted unstyled is a screen
// nobody sees; it is the product's one stylesheet wherever a screen renders
import '../../../../../../apps/web/src/app.css'

// This package's own use of the testkit: this plugin's catalogs and nobody
// else's, so a test here is a test of this plugin's host.

export { emptyManifest, fakeClient } from '@qualy/testkit/browser'

export const renderScreen = (options: Parameters<typeof render>[0]) => render({ ...options })
