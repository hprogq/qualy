import { z } from 'zod'
import { get } from '@qualy/api-contract'

const namespaced = z.string().regex(/^[a-z][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)+$/i)

const layoutSchema = z.object({
  contract: namespaced,
  provider: namespaced,
  component: z.string(),
})

const pageSchema = z.object({
  id: namespaced,
  path: z.string(),
  component: z.string(),
  layout: namespaced,
})

const slotItemSchema = z.object({
  id: namespaced,
  component: z.string(),
  order: z.number(),
})

// the manifest is an authorized projection (rbac filtering lands with the
// authorizer): core fields are precise, surface payloads stay open because
// collection item shapes belong to their tokens
export const uiContract = {
  getManifest: get('/ui/manifest').output(
    z.object({
      layouts: layoutSchema.array(),
      pages: pageSchema.array(),
      collections: z.record(z.string(), z.array(z.unknown())),
      slots: z.record(z.string(), slotItemSchema.array()),
    }),
  ),
}
