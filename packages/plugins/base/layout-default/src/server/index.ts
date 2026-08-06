import type { Layer } from 'effect'
import { registerSurfaces, type Ui } from '@qualy/plugin-ui-registry/server/registry'
import { surfaces } from '../ui.ts'

// A layout plugin ships one thing to the running application: the
// implementation behind a layout contract. It answers no peer and owns no
// state, so registering it is the whole entry.
export const layer: Layer.Layer<never, never, Ui> = registerSurfaces(surfaces)
