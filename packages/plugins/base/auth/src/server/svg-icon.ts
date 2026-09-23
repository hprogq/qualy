import { createHash } from 'node:crypto'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { LOGIN_ICON_SVG_MAX_BYTES } from '../api.ts'

// Whether a piece of SVG may stand as a door's icon.
//
// An SVG is a document, not a picture: it can carry script, event handlers,
// references to other documents and embedded HTML. Drawn in an `<img>` none
// of that runs, but the icon's own address is anonymous and same-origin, and
// a visitor who opens it directly gets a document. So an icon is held to what
// a drawing needs - shapes, paint, gradients, masks, a few filters - and
// anything else refuses the whole file rather than being cut out of it: a
// sanitiser that rewrites markup is a second parser whose disagreements with
// the browser's are the attack. What passes is kept byte for byte and served
// with a policy that runs nothing, as a second lock.

const MAX_DEPTH = 32

/** what a drawing is made of; any other element refuses the file */
const ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'filter',
  'feblend',
  'fecolormatrix',
  'fecomposite',
  'feflood',
  'fegaussianblur',
  'femerge',
  'femergenode',
  'feoffset',
])

/** only the five entities XML predefines: a numeric one is how a word is hidden */
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos);)/

/** the one document type a drawing may name: SVG's own, with nothing defined inside it */
const PUBLIC_DOCTYPE = /^<!DOCTYPE\s+svg\s+PUBLIC\s+"[^"\[\]<>]*"\s+"[^"\[\]<>]*"\s*>$/i

/** words that only ever reach outside the drawing, anywhere in it */
const REACHING = [
  /javascript\s*:/i,
  /@import/i,
  /expression\s*\(/i,
  // a paint server in this file is `url(#id)`; anything else fetches
  /url\s*\(\s*['"]?\s*(?!#)/i,
]

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: false,
  maxNestedTags: MAX_DEPTH,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  commentPropName: '#comment',
})

type Ordered = Record<string, unknown>

const localName = (name: string) => name.slice(name.indexOf(':') + 1).toLowerCase()

/** every element under these nodes is one a drawing needs, with no attribute that acts */
const drawingOnly = (nodes: readonly Ordered[]): boolean => {
  for (const node of nodes) {
    const name = Object.keys(node).find((key) => key !== ':@')
    if (name === undefined || name === '#text' || name === '#comment') continue
    if (!ELEMENTS.has(localName(name))) return false
    const attributes = (node[':@'] ?? {}) as Record<string, unknown>
    for (const [key, value] of Object.entries(attributes)) {
      const attribute = localName(key)
      if (attribute.startsWith('on')) return false
      // a reference inside the file is `#id`; any other is a document
      if (attribute === 'href' && !String(value).trim().startsWith('#')) return false
    }
    if (!drawingOnly(node[name] as readonly Ordered[])) return false
  }
  return true
}

/** the markup as it may be served, or undefined when it cannot be an icon */
export const checkedSvg = (markup: string): string | undefined => {
  if (Buffer.byteLength(markup, 'utf8') > LOGIN_ICON_SVG_MAX_BYTES) return undefined
  // Design tools write `<!DOCTYPE svg PUBLIC "..." "...">`, which a browser
  // never fetches. A declaration with an internal subset - `[...]` - is where
  // entities are defined, and it and any entity are refused.
  if (/<!ENTITY/i.test(markup)) return undefined
  const doctypes = markup.match(/<!DOCTYPE[^>]*>?/gi) ?? []
  if (doctypes.length > 1 || doctypes.some((doctype) => !PUBLIC_DOCTYPE.test(doctype))) {
    return undefined
  }
  // the parser skips processing instructions, and a browser follows an
  // `xml-stylesheet` one: only the declaration at the very top may be there
  if (/<\?/.test(markup.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/, ''))) return undefined
  if (ENTITY.test(markup)) return undefined
  if (REACHING.some((word) => word.test(markup))) return undefined
  if (XMLValidator.validate(markup) !== true) return undefined
  let parsed: readonly Ordered[]
  try {
    parsed = parser.parse(markup) as readonly Ordered[]
  } catch {
    return undefined
  }
  const roots = parsed.filter((node) => {
    const name = Object.keys(node).find((key) => key !== ':@')
    return name !== undefined && name !== '#text' && name !== '#comment'
  })
  // one drawing, in the namespace a browser draws an `<img>` from
  if (roots.length !== 1 || Object.keys(roots[0]!).find((key) => key !== ':@') !== 'svg') {
    return undefined
  }
  const namespace = ((roots[0]![':@'] ?? {}) as Record<string, unknown>)['xmlns']
  if (namespace !== 'http://www.w3.org/2000/svg') return undefined
  return drawingOnly(roots) ? markup : undefined
}

/** what a served SVG is addressed by: a new drawing is a new address */
export const svgVersion = (markup: string) =>
  createHash('sha256').update(markup).digest('hex').slice(0, 32)
