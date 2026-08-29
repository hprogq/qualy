/**
 * The QuickJS execution engine, business-blind on purpose: a pool of worker
 * threads, a plain-data invoke protocol, resource limits and an identity.
 * It knows nothing of plugins, databases, HTTP or formulas - the sandbox
 * plugin (in-process today, a remote adapter tomorrow) is who dresses this
 * in Effect services and typed errors.
 */

export { WorkerPool, type PoolOptions, type PoolProblem } from './pool.ts'
export {
  ENTRYPOINT,
  type InvokeRequest,
  type InvokeResponse,
  type JsonValue,
  type WorkerVerdict,
} from './protocol.ts'
export { engineIdentity, runtimeBuildId } from './identity.ts'
