import { randomUUID } from 'node:crypto'
import { Config, Effect, Option, Schema } from 'effect'

/**
 * The identity every exported signal carries, resolved once per process.
 *
 * Operators own the standard OpenTelemetry variables; this module only fills
 * what they left unsaid. `OTEL_SERVICE_NAME` beats `OTEL_RESOURCE_ATTRIBUTES`
 * beats the defaults - the same precedence the OTel spec gives the variables
 * themselves - so a deployment that sets `service.namespace=staging-lab` in
 * the environment is never overwritten by the `qualy` default below.
 *
 * The instance id exists so two replicas of the same service stay separable
 * in a metrics backend without renaming the service. It is stable for the
 * life of the process: either the operator's `QUALY_INSTANCE_ID` or one
 * random id minted at boot.
 */
export interface ResourceDescription {
  readonly serviceName: string
  readonly serviceVersion: string | undefined
  readonly attributes: Record<string, string>
}

const declaredAttributes = Config.schema(
  Schema.UndefinedOr(Config.Record(Schema.StringFromUriComponent, Schema.StringFromUriComponent)),
  'OTEL_RESOURCE_ATTRIBUTES',
)

export const resourceFromEnv: Effect.Effect<ResourceDescription> = Effect.gen(function* () {
  const { name, version, qualyVersion, instanceId, nodeEnv, declared } = yield* Config.all({
    name: Config.option(Config.string('OTEL_SERVICE_NAME')),
    version: Config.option(Config.string('OTEL_SERVICE_VERSION')),
    qualyVersion: Config.option(Config.string('QUALY_VERSION')),
    instanceId: Config.option(Config.string('QUALY_INSTANCE_ID')),
    nodeEnv: Config.option(Config.string('NODE_ENV')),
    declared: declaredAttributes,
  })
  const env = declared ?? {}
  const attributes: Record<string, string> = {}
  if (env['service.namespace'] === undefined) {
    attributes['service.namespace'] = 'qualy'
  }
  if (env['deployment.environment.name'] === undefined) {
    attributes['deployment.environment.name'] =
      Option.getOrUndefined(nodeEnv) === 'production' ? 'production' : 'development'
  }
  if (env['service.instance.id'] === undefined) {
    attributes['service.instance.id'] = Option.getOrUndefined(instanceId) ?? randomUUID()
  }
  return {
    serviceName: Option.getOrUndefined(name) ?? env['service.name'] ?? 'qualy-server',
    serviceVersion:
      Option.getOrUndefined(version) ??
      Option.getOrUndefined(qualyVersion) ??
      env['service.version'],
    attributes,
  }
}).pipe(Effect.orDie)
