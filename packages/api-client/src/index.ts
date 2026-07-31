import { createORPCClient } from '@orpc/client'
import type { RouterContractClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi'
import { populateRouterContractOpenAPIPaths } from '@orpc/openapi'
import { OpenAPILink } from '@orpc/openapi/fetch'
import { appContract, type AppContract } from './contracts.gen.ts'

// procedures without explicit openapi metadata fall back to their router
// position as the http path
const populated = populateRouterContractOpenAPIPaths(appContract)

// accepts either a path like '/api' (browser, same origin) or a full base
// URL like 'http://localhost:3000/api' (scripts, ssr)
export function createApiClient(base: string) {
  let origin: string | undefined
  let url: `/${string}`
  if (base.startsWith('/')) {
    url = base as `/${string}`
  } else {
    const parsed = new URL(base)
    origin = parsed.origin
    url = parsed.pathname as `/${string}`
  }
  const link = new OpenAPILink(populated, { origin, url })
  const client: JsonifiedClient<RouterContractClient<AppContract>> = createORPCClient(link)
  return client
}

export type AppClient = ReturnType<typeof createApiClient>
export type { AppContract }
export { appContract }
