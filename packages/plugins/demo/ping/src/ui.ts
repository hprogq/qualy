import { ADMIN_SHELL, PUBLIC, defineSurfaces, definePage } from '@qualy/ui-contract'
import { pingNavigationLabel } from './messages.ts'

export const pingPage = definePage({ id: 'ping/page', path: '/ping' })

export const surfaces = defineSurfaces({
  pages: [
    {
      page: pingPage,
      component: 'ping/PingPage',
      layout: ADMIN_SHELL,
      // the demo endpoint is deliberately open; a real plugin would gate this
      visibility: PUBLIC,
      navigation: { label: pingNavigationLabel, order: 10 },
    },
  ],
})
