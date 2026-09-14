// compiled output: no jsx, no source map, nothing pointing back at a source
import { jsx, jsxs } from 'react/jsx-runtime'
import { useI18n } from '@qualy/web-i18n'
import { messages } from './i18n.js'

export const ACME_BROWSER_PROBE_STANDING = 'probe-3c07fe'

export default function ProbePage() {
  const { format } = useI18n()
  return jsxs('section', {
    children: [
      jsx('h1', { children: format(messages.title) }),
      jsx('p', {
        'data-probe-standing': ACME_BROWSER_PROBE_STANDING,
        children: format(messages.standing),
      }),
    ],
  })
}
