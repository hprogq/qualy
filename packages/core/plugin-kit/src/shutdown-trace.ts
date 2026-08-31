/**
 * Where a shutdown is spending its time.
 *
 * The host already knows when a shutdown as a whole overruns its deadline;
 * what it cannot say is which of the assembled layers is still releasing
 * when the clock runs out. This is the seam that answers that, and nothing
 * else: it observes the finalizer boundaries a layer already has, it never
 * changes their order, never swallows a failure, never detaches a resource
 * and never lets a timed-out release count as finished.
 *
 * The tracer is installed by the host (which owns the logger); with none
 * installed every call here is a no-op, so tests and the CLI carry no cost.
 */

export interface LayerLifecycleTracer {
  /** the layer's own finalizers are about to run */
  readonly finalizing: (name: string) => void
  /** they have all run, and how long that took */
  readonly finalized: (name: string, elapsedMs: number) => void
}

let installed: LayerLifecycleTracer | undefined
const started = new Map<string, number>()

/** installs (or with `undefined`, removes) the observer of layer teardown */
export const traceLayerLifecycle = (tracer: LayerLifecycleTracer | undefined): void => {
  installed = tracer
  started.clear()
}

export const layerFinalizing = (name: string): void => {
  if (installed === undefined) return
  started.set(name, Date.now())
  installed.finalizing(name)
}

export const layerFinalized = (name: string): void => {
  if (installed === undefined) return
  const at = started.get(name)
  started.delete(name)
  installed.finalized(name, at === undefined ? 0 : Date.now() - at)
}

/** the layers that began releasing and never finished - the shutdown
 *  watchdog prints exactly this when it gives up */
export const stillFinalizing = (): readonly string[] => [...started.keys()]
