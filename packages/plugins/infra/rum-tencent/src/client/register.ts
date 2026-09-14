import { registerRumProvider } from '@qualy/plugin-rum/client'
import { tencentRumProvider } from './provider.ts'

// The browser half's announcement, and nothing else.
//
// Declared `Ui.browser`, which means it runs on EVERY page load of every
// deployment that has this plugin installed - including ones with reporting
// switched off, because a production build is a superset. So it must stay a
// name and a function: whether anything is reported is decided by the
// capability, after it has asked the server, and the vendor sdk is imported
// only once that answer is yes.

registerRumProvider(tencentRumProvider)
