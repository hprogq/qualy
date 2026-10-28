// The four application shells, served from one module.
//
// The runtime fetches every layout a manifest names before it draws. A
// signed-in manifest names the app, workspace and account shells, and the
// user detail shell for whoever may read other users; the last three are
// the same rail under different strips. Behind four dynamic imports the
// bundler split what they share by which of them reaches it, into chunks
// that arrive together anyway. One module is one entry, so what they share
// pools as one. The blank shell stays apart: the sign-in page draws it and
// none of these.
export { default as AppShell } from './AppShell.tsx'
export { default as WorkspaceShell } from './WorkspaceShell.tsx'
export { default as UserDetailShell } from './UserDetailShell.tsx'
export { default as AccountShell } from './AccountShell.tsx'
