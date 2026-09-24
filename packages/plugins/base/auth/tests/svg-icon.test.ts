import { describe, expect, it } from 'vitest'
import { checkedSvg } from '../src/server/svg-icon.ts'

// What an SVG must be to stand as a door's icon: a drawing and nothing more.
// Each refusal is a way a file reaches outside itself or runs something when
// its address is opened on its own.

const svg = (inner: string, attributes = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"${attributes}>${inner}</svg>`

describe('an SVG offered as an icon', () => {
  it('is kept as it came when it is only a drawing', () => {
    const drawings = [
      svg('<path d="M0 0h24v24H0z" fill="#24292f"/>'),
      `<?xml version="1.0" encoding="UTF-8"?>\n${svg('<circle cx="12" cy="12" r="10"/>')}`,
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>' +
          '<rect width="24" height="24" fill="url(#g)"/><use href="#g"/>',
      ),
      svg('<style>.a{fill:#07c160}</style><title>Mark</title><path class="a" d="M1 1h2v2H1z"/>'),
      svg('<!-- exported --><g><path d="M0 0h1v1H0z"/></g>'),
      // what design tools write at the top; a browser never fetches it
      `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svg(
        '<g><path d="M0 0h1v1H0z" style="fill:#c00;fill-rule:nonzero;"/></g>',
        ' xmlns:serif="http://www.serif.com/" xml:space="preserve"',
      )}`,
    ]
    for (const drawing of drawings) expect(checkedSvg(drawing), drawing).toBe(drawing)
  })

  it('is refused when it runs, reaches out or is not one drawing', () => {
    const refused = [
      svg('<script>alert(1)</script>'),
      svg('', ' onload="alert(1)"'),
      svg('<rect onclick="x()" width="1" height="1"/>'),
      svg('<a href="https://example.com"><path d="M0 0h1v1H0z"/></a>'),
      svg('<use href="https://example.com/sprite.svg#x"/>'),
      svg(
        '<use xlink:href="data:image/svg+xml,x"/>',
        ' xmlns:xlink="http://www.w3.org/1999/xlink"',
      ),
      svg('<image href="https://example.com/a.png"/>'),
      svg('<foreignObject><div>html</div></foreignObject>'),
      svg('<style>@import "https://example.com/a.css";</style>'),
      svg('<rect style="fill:url(https://example.com/a)" width="1" height="1"/>'),
      svg('<path d="M0 0" fill="&#106;avascript"/>'),
      `<!DOCTYPE svg [<!ENTITY x "y">]>${svg('')}`,
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "a.dtd" [<!ATTLIST svg x CDATA "y">]>${svg('')}`,
      `<!DOCTYPE html>${svg('')}`,
      `<?xml-stylesheet href="https://example.com/a.css"?>${svg('')}`,
      '<svg viewBox="0 0 1 1"/>',
      `${svg('')}${svg('')}`,
      '<html><body/></html>',
      '<svg xmlns="http://www.w3.org/2000/svg"><path',
      svg(`<path d="${'M0 0'.repeat(20_000)}"/>`),
    ]
    for (const file of refused) expect(checkedSvg(file), file.slice(0, 120)).toBeUndefined()
  })
})
