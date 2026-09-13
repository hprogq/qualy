import { webRelease } from 'virtual:qualy/release'
import { createReleaseCoordinator } from '@qualy/web-runtime/release'

// The page's release and its coordinator, made once for the page: the
// entry starts it before anything renders, the recovery gate reads it, and
// the api transport tells it when the server refuses this page.

export { webRelease }

export const releases = createReleaseCoordinator({ current: webRelease })
