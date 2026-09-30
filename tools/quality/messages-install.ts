import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installProductMessages } from '@qualy/text/node'

// Each node test file's setup: what the server says, it says from the
// messages the global setup compiled, as a started server does.
await installProductMessages(path.resolve(fileURLToPath(new URL('../..', import.meta.url))))
