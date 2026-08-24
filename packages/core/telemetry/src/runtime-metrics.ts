import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { Duration, Effect, Metric } from 'effect'

// What the process itself is doing, from stable Node APIs and nothing else.
//
// No OTel runtime instrumentation package: process.cpuUsage, memoryUsage and
// perf_hooks' event-loop monitors are documented Node APIs, and a poll loop
// over them is the entire dependency surface. GC pause metrics would need a
// PerformanceObserver subscription with its own overhead story; they wait
// until someone actually reasons about GC.
//
// Instrument types follow semconv where the name does: process.cpu.time is a
// monotonic counter, process.memory.usage an UpDownCounter (a non-incremental
// effect counter fed deltas, so the reported sum is the current RSS). The
// heap number is deliberately NOT v8js.memory.heap.used - that convention
// measures per-heap-space from v8.getHeapSpaceStatistics(), which nobody here
// reasons about yet - so the simple total wears a qualy name instead of
// impersonating a standard it does not implement.

const POLL_INTERVAL = Duration.seconds(15)

const cpuTime = Metric.counter('process.cpu.time', {
  description: 'CPU seconds consumed by the process.',
  incremental: true,
})
const rss = Metric.counter('process.memory.usage', {
  description: 'Resident set size of the process.',
})
const rssBytes = Metric.withAttributes(rss, { unit: 'By' })
const heapUsed = Metric.gauge('qualy.runtime.heap.used', {
  description: 'Total used V8 heap, process-wide.',
  attributes: { unit: 'By' },
})
const loopDelayMean = Metric.gauge('nodejs.eventloop.delay.mean', {
  description: 'Mean event loop delay over the last poll interval.',
  attributes: { unit: 's' },
})
const loopDelayMax = Metric.gauge('nodejs.eventloop.delay.max', {
  description: 'Max event loop delay over the last poll interval.',
  attributes: { unit: 's' },
})
const loopUtilization = Metric.gauge('nodejs.eventloop.utilization', {
  description: 'Event loop utilization over the last poll interval, 0 to 1.',
})

const mode = (value: 'user' | 'system') =>
  Metric.withAttributes(cpuTime, { 'cpu.mode': value, unit: 's' })

/**
 * The poll loop the telemetry layer forks while metrics export is on.
 *
 * Counters take deltas (the exporter reports them cumulatively), gauges take
 * the latest reading, and the event-loop histogram is reset each round so a
 * quiet hour cannot dilute a bad minute. The delay monitor is a real
 * resource: sampling stops with `disable()` when the scope closes, not by
 * abandonment.
 */
export const runtimeMetricsLoop: Effect.Effect<never> = Effect.scoped(
  Effect.gen(function* () {
    const loopDelay = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const monitor = monitorEventLoopDelay({ resolution: 20 })
        monitor.enable()
        return monitor
      }),
      (monitor) => Effect.sync(() => void monitor.disable()),
    )
    let cpu = process.cpuUsage()
    let utilization = performance.eventLoopUtilization()
    let lastRss = 0
    const poll = Effect.sync(() => {
      const nextCpu = process.cpuUsage()
      const nextUtilization = performance.eventLoopUtilization()
      const memory = process.memoryUsage()
      const round = {
        user: (nextCpu.user - cpu.user) / 1e6,
        system: (nextCpu.system - cpu.system) / 1e6,
        rssDelta: memory.rss - lastRss,
        utilization: performance.eventLoopUtilization(nextUtilization, utilization).utilization,
        delayMean: loopDelay.mean / 1e9,
        delayMax: loopDelay.max / 1e9,
      }
      cpu = nextCpu
      utilization = nextUtilization
      lastRss = memory.rss
      loopDelay.reset()
      return { round, memory }
    }).pipe(
      Effect.flatMap(({ round, memory }) =>
        Effect.all(
          [
            Metric.update(mode('user'), round.user),
            Metric.update(mode('system'), round.system),
            Metric.update(rssBytes, round.rssDelta),
            Metric.update(heapUsed, memory.heapUsed),
            Metric.update(loopDelayMean, round.delayMean),
            Metric.update(loopDelayMax, round.delayMax),
            Metric.update(loopUtilization, round.utilization),
          ],
          { discard: true },
        ),
      ),
    )
    return yield* Effect.sleep(POLL_INTERVAL).pipe(Effect.andThen(poll), Effect.forever)
  }),
)
