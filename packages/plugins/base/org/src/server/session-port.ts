// Re-exported so the handler reads the principal through one import rather
// than reaching into auth's module layout. The tag itself is auth's; this is
// only where org names it.
export { CurrentUser } from '@qualy/plugin-auth/server/session'
