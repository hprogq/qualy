// compiled output: no jsx, no source map, nothing pointing back at a source
import * as m from '#messages'

export const ACME_PROBE_PAGE_MARKER = 'acme-dist-probe-page-8f21c6'
export default function ProbePage() {
  return `${ACME_PROBE_PAGE_MARKER} ${m.probe_title()}`
}
