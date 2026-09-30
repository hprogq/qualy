// compiled output: no jsx, no source map, nothing pointing back at a source
import { jsx, jsxs } from 'react/jsx-runtime'
import * as m from '#messages'

export const ACME_BROWSER_PROBE_STANDING = 'probe-3c07fe'

export default function ProbePage() {
  return jsxs('section', {
    children: [
      jsx('h1', { children: m.page_title() }),
      jsx('p', {
        'data-probe-standing': ACME_BROWSER_PROBE_STANDING,
        children: m.page_standing(),
      }),
    ],
  })
}
