import { Plugin } from '@qualy/plugin-kit'
import { Cli } from '@qualy/plugin-kit/cli'
import { serviceLayer } from './service.ts'

// The execution mechanism and nothing else: a resource-limited, deterministic
// QuickJS behind one service. What runs in it, and what its results mean, is
// entirely the caller's business — this plugin never learns.

const plugin = Plugin.define(
  '@qualy/plugin-sandbox',
  Plugin.layer(serviceLayer),
  // the operator's question after a deployment: are both sandbox processes
  // reachable over their sockets, speaking this host's protocol?
  Cli.command({
    namespace: 'sandbox',
    name: 'status',
    summary: 'reach both sandbox processes over their sockets and report the protocol they speak',
    context: 'assembly',
    load: () => import('./status-command.ts'),
  }),
)

export default plugin
