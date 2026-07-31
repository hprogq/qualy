import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { z } from 'zod'

export const pingContract = {
  hello: oc
    .meta(openapi({ method: 'GET', path: '/ping/hello' }))
    .input(z.object({ name: z.string().optional() }))
    .output(z.object({ msg: z.string() })),
}
