import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import '../src/app.css'

// The product's baseline, measured on bare elements.
//
// Two thirds of the buttons on these screens are plain <button> elements - a
// row that opens a panel, a chip that drops itself - and a baseline is the
// only thing standing between them and the browser's own chrome. That
// baseline arrived with the utility framework this migration removed, and
// nothing in the widget library replaces it: its own reset sets a font and a
// text-transform and stops. When it went, every plain button in the product
// came back wearing native chrome, and no test noticed, because the
// assertions are all on roles and on the components the library dresses.
//
// So the baseline is stated by this product now, and this is what holds it:
// what the browser computes for a bare element, recorded in full. The values
// were captured with the old framework still installed and have not moved.
const WATCHED = [
  'boxSizing',
  'margin',
  'padding',
  'borderWidth',
  'borderStyle',
  'borderColor',
  'backgroundColor',
  'backgroundImage',
  'appearance',
  'font',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'lineHeight',
  'color',
  'textAlign',
  'textDecorationLine',
  'textIndent',
  'textTransform',
  'listStyleType',
  'listStylePosition',
  'display',
  'verticalAlign',
  'borderCollapse',
  'borderSpacing',
  'minWidth',
  'maxWidth',
  'height',
  'cursor',
  'whiteSpace',
  'overflowWrap',
  'tabSize',
  'outlineColor',
]

it('dresses every bare element the product uses', async () => {
  render(
    <div data-testid="bare">
      <button type="button">b</button>
      <input defaultValue="i" />
      <textarea defaultValue="t" />
      <select>
        <option>o</option>
      </select>
      <h1>h1</h1>
      <h2>h2</h2>
      <h3>h3</h3>
      <p>p</p>
      <ul>
        <li>li</li>
      </ul>
      <ol>
        <li>li</li>
      </ol>
      <dl>
        <dt>dt</dt>
        <dd>dd</dd>
      </dl>
      <a href="#x">a</a>
      <table>
        <tbody>
          <tr>
            <th>th</th>
            <td>td</td>
          </tr>
        </tbody>
      </table>
      <hr />
      <fieldset>
        <legend>legend</legend>
      </fieldset>
      <blockquote>bq</blockquote>
      <pre>pre</pre>
      <code>code</code>
      <figure>fig</figure>
      <form>
        <label>label</label>
      </form>
      <svg viewBox="0 0 8 8" />
      <img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
      <strong>strong</strong>
      <small>small</small>
    </div>,
  )
  await new Promise((resolve) => setTimeout(resolve, 200))
  const seat = document.querySelector('[data-testid="bare"]')!
  const rows: string[] = []
  for (const node of seat.querySelectorAll('*')) {
    const style = getComputedStyle(node)
    rows.push(
      `${node.tagName.toLowerCase()}: ${WATCHED.map((k) => `${k}=${style[k as never]}`).join(' ')}`,
    )
  }
  // the html and body the app itself dresses
  for (const node of [document.documentElement, document.body]) {
    const style = getComputedStyle(node)
    rows.push(
      `${node.tagName.toLowerCase()}: ${WATCHED.map((k) => `${k}=${style[k as never]}`).join(' ')}`,
    )
  }
  await expect(rows.join('\n')).toMatchFileSnapshot('./__snapshots__/baseline.txt')
})
