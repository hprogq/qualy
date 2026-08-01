import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { z } from 'zod'

const pageSchema = z.object({
  path: z.string(),
  component: z.string(),
  layout: z.enum(['admin', 'blank']),
  public: z.boolean().optional(),
  permission: z.string().optional(),
})

const navSchema = z.object({
  path: z.string(),
  label: z.string(),
  icon: z.string().optional(),
  order: z.number().optional(),
})

export const uiContract = {
  getManifest: oc
    .meta(openapi({ method: 'GET', path: '/ui/manifest' }))
    .output(z.object({ pages: pageSchema.array(), nav: navSchema.array() })),
}
