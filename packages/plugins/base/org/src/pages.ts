import { definePage } from '@qualy/ui-contract'

// This plugin's page identities: id and path, nothing else. A leaf module
// with no framework in it, because both sides import it - the entry registers
// the page, and any plugin's browser code links to it through PageLink.

export const orgPage = definePage({ id: 'org/page', path: '/admin/org' })
