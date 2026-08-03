import type { CatalogFor } from '@qualy/i18n-contract'
import { pingNavigationLabel } from '../../src/messages.ts'

const declared = { navigation: pingNavigationLabel } as const

export default {
  'ping/navigation/ping': 'Ping',
} satisfies CatalogFor<typeof declared>
