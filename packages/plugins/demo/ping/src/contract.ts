import { z } from 'zod'
import { get } from '@qualy/api-contract'

export const pingContract = {
  hello: get('/ping/hello')
    .input(z.object({ name: z.string().optional() }))
    .output(z.object({ msg: z.string() })),
}
