import fs from 'node:fs'
import path from 'node:path'

import { markPaths, wordmarkLayout } from '../../packages/web/brand/src/geometry.ts'

// Writes the brand's static files from the geometry: the two SVGs other
// people take (a README, a partner's slide) and the favicon. A design tool
// rather than a build step - what it writes is reviewed and committed like
// an export from a drawing program, and nothing checks that running it
// again produces no diff (docs/brand.md); the favicon's agreement with the
// geometry is what a test guards, not a generator.

const ROOT = path.resolve(import.meta.dirname, '../..')
const ASSETS = path.join(ROOT, 'packages/web/brand/assets')
const FAVICON = path.join(ROOT, 'apps/web/public/favicon.svg')

const mark = markPaths(16)
const wordmark = wordmarkLayout(16)

const svg = (viewBox: string, body: readonly string[], attributes = 'fill="currentColor"') =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ${attributes}>`,
    ...body.map((line) => `  ${line}`),
    '</svg>',
    '',
  ].join('\n')

const segments = (paths: readonly string[]) =>
  paths.map((d, k) => `<path data-seg="${k}" d="${d}"/>`)

const files: readonly [string, string][] = [
  [
    path.join(ASSETS, 'mark.svg'),
    svg(mark.viewBox, ['<title>Qualy</title>', ...segments(mark.segments)]),
  ],
  [
    path.join(ASSETS, 'wordmark.svg'),
    svg(wordmark.viewBox, [
      '<title>Qualy</title>',
      ...segments(wordmark.segments),
      ...wordmark.letters.map((letter) => `<path data-letter="${letter.char}" d="${letter.d}"/>`),
    ]),
  ],
  // the browser tab has no page colour to inherit, so the icon carries the
  // two inks itself and picks by the system scheme
  [
    FAVICON,
    svg(
      mark.viewBox,
      [
        '<style>path{fill:#18191D}@media (prefers-color-scheme:dark){path{fill:#FAFAF8}}</style>',
        ...segments(mark.segments),
      ],
      '',
    ).replace(' >', '>'),
  ],
]

for (const [file, content] of files) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  console.log(`brand: wrote ${path.relative(ROOT, file)}`)
}
