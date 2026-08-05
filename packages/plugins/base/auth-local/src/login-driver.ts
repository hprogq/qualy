import type { LoginDriver } from '@qualy/auth-contract/login'

// How this driver asks to be presented, and nothing else.
//
// A zero-dependency module on purpose: the assembly imports it to build the
// driver catalog, and pulling the whole plugin in to learn its name would make
// the catalog depend on everything any driver happens to need.

export const driver: LoginDriver = {
  type: 'local',
  describe: () => ({ mode: 'component', component: 'auth-local/LoginMethod' }),
}
