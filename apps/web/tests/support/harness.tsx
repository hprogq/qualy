import { type ReactNode } from 'react'
import { renderScreen as render, type FakeClient } from '@qualy/testkit/browser'
// the real stylesheet, exactly as the app loads it: a host test asserts the
// product as it ships, and the product ships styled
import '../../src/app.css'

// The host harness shares the production runtime and the product stylesheet.

export {
  addressNow,
  apiError,
  emptyManifest,
  fakeClient,
  type FakeClient,
  type FakeManifest,
} from '@qualy/testkit/browser'

export const renderScreen = (
  options: Parameters<typeof render>[0] & {
    client: FakeClient
    children?: ReactNode
  },
) => render({ ...options })
