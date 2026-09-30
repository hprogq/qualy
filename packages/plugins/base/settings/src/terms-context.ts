// The key a page reads a tenant's words by, in the document context the
// manifest carries: `{ [termId]: word }`, said in the page's language, every
// declared term present (docs/adr/0011-i18n-paraglide.md, decision 10).
// Shared by the server that provides it and the hook that reads it.
export const TERMS_CONTEXT = 'settings/terms'
