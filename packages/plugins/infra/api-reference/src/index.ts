import { StandardJsonSchemaConverter } from '@orpc/json-schema'
import { OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIReferenceHandlerPlugin } from '@orpc/openapi/plugins'
import type { Context } from 'cordis'
import { z } from 'zod'
import { mountPath } from '@qualy/plugin-server'

export const name = 'api-reference'
export const inject = ['server']

export const Config = z
  .object({
    // auto serves the reference outside production only; public serves it
    // unconditionally (a deliberate decision for e.g. a public sandbox)
    exposure: z.enum(['auto', 'off', 'public']).default('auto'),
    // both paths live under the api prefix, so the defaults resolve to
    // /api/docs and /api/openapi.json
    docsPath: mountPath('docsPath').default('/docs'),
    specPath: mountPath('specPath').default('/openapi.json'),
    title: z.string().default('Qualy API'),
    version: z.string().default('0.0.0'),
  })
  .refine((config) => config.docsPath !== config.specPath, {
    message: 'docsPath and specPath must differ',
  })
  .prefault({})

export function apply(ctx: Context, rawConfig: z.input<typeof Config>) {
  // the loader validates through Config before apply, so the value is parsed
  const config = rawConfig as z.output<typeof Config>
  const enabled =
    config.exposure === 'public' ||
    (config.exposure === 'auto' && process.env.NODE_ENV !== 'production')
  if (!enabled) {
    ctx.logger.info('api reference disabled (exposure: %s)', config.exposure)
    return
  }

  // zod 4 speaks standard json schema natively, no zod-specific converter
  // package needed (probed against beta.21)
  const generator = new OpenAPIGenerator({ converters: [new StandardJsonSchemaConverter()] })
  ctx.server.contributeOpenApiPlugin('api-reference', ({ router, prefix }) => {
    // the factory runs on every handler rebuild, so this cache lives exactly
    // as long as the router snapshot it documents
    let document: ReturnType<OpenAPIGenerator['generate']> | undefined
    return new OpenAPIReferenceHandlerPlugin({
      spec: () =>
        (document ??= generator.generate(router, {
          base: {
            info: { title: config.title, version: config.version },
            // paths are prefix-relative; the servers entry makes scalar (and
            // any other spec consumer) resolve requests against the mount
            servers: [{ url: prefix }],
          },
        })),
      specPath: config.specPath as `/${string}`,
      docsPath: config.docsPath as `/${string}`,
      docsTitle: config.title,
    })
  })
}
