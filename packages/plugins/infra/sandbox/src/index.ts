import { Plugin } from '@qualy/plugin-kit'
import { serviceLayer } from './service.ts'

// The execution mechanism and nothing else: a resource-limited, deterministic
// QuickJS behind one service. What runs in it, and what its results mean, is
// entirely the caller's business — this plugin never learns.

const plugin = Plugin.define('@qualy/plugin-sandbox', Plugin.layer(serviceLayer))

export default plugin
