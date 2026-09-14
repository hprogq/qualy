import { installEarlyListeners } from './queue.ts'

// The first import of the browser entry, and the only module here with a side
// effect.
//
// It is a module of its own so the order is stated rather than hoped for:
// `import '@qualy/plugin-rum/client/bootstrap'` at the top of the entry runs
// before the application's own graph, which is the window this exists for.
//
// Deliberately NOT moved into the shell's inline boot script. That script is
// pinned by a content security policy hash and is the one thing that still
// works when everything else is broken; putting a reporting concern in it
// would trade a very small reliable recovery layer for a slightly earlier
// first listener.

installEarlyListeners()
