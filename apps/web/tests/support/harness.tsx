import type { ReactNode } from 'react'
import { catalogs, errorMessages } from 'virtual:qualy/plugins'
import { renderScreen as render, type FakeClient } from '@qualy/testkit/browser'
// the real stylesheet, exactly as the app loads it: a host test asserts the
// product as it ships, and the product ships styled
import '../../src/app.css'

// The host's own use of the testkit: the same harness, with the whole
// assembly's catalogs already in it.
//
// A test in this folder is about the product - the shell, the cold start,
// the release protocol, localisation across screens - so it gets what the
// product has. A test about ONE plugin lives in that plugin and brings that
// plugin's catalogs, which is what keeps it from being a whole-composition
// test wearing a smaller name.

export {
  addressNow,
  apiError,
  emptyManifest,
  fakeClient,
  type FakeClient,
  type FakeManifest,
} from '@qualy/testkit/browser'

export const renderScreen = (
  options: Omit<Parameters<typeof render>[0], 'catalogs' | 'errorMessages'> & {
    client: FakeClient
    children?: ReactNode
  },
) => render({ ...options, catalogs, errorMessages })
