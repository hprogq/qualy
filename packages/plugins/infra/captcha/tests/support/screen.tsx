import { renderScreen as render } from '@qualy/testkit/browser'
import {
  catalogs as captchaCatalogs,
  errorMessages as captchaErrors,
} from '../../src/client/i18n.ts'
// the host's stylesheet, because a screen asserted unstyled is a screen
// nobody sees; it is the product's one stylesheet wherever a screen renders
import '../../../../../../apps/web/src/app.css'

// This package's own use of the testkit: this plugin's catalogs and nobody
// else's, so a test here is a test of this plugin's host.

export const catalogs = [captchaCatalogs]
export const errorMessages = { ...captchaErrors }

export { emptyManifest, fakeClient } from '@qualy/testkit/browser'

export const renderScreen = (
  options: Omit<Parameters<typeof render>[0], 'catalogs' | 'errorMessages'>,
) => render({ ...options, catalogs, errorMessages })
