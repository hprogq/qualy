import { renderScreen as render } from '@qualy/testkit/browser'
import {
  catalogs as settingsCatalogs,
  errorMessages as settingsErrors,
} from '../../src/client/i18n.ts'
// the host's stylesheet, because a screen asserted unstyled is a screen
// nobody sees; it is the product's one stylesheet wherever a screen renders
import '../../../../../../apps/web/src/app.css'

// This package's own use of the testkit: this plugin's catalogs and nobody
// else's, so a test here is a test of this plugin's screens.

export const catalogs = [settingsCatalogs]
export const errorMessages = { ...settingsErrors }

export {
  apiError,
  emptyManifest,
  fakeClient,
  type FakeClient,
  type FakeManifest,
} from '@qualy/testkit/browser'

export const renderScreen = (
  options: Omit<Parameters<typeof render>[0], 'catalogs' | 'errorMessages'>,
) => render({ ...options, catalogs, errorMessages })
