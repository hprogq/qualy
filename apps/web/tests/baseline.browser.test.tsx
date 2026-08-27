import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import '../src/app.css'

// The Qualy DOM baseline, measured.
//
// Native elements are semantic primitives across this product - two thirds of
// its buttons are plain <button> - and what they look like belongs to the
// component that renders them, never to the browser. The widget library
// dresses its own components and stops there, so the baseline that clears the
// user agent out of the way is this product's own.
//
// It is worth measuring because nothing else here does: every other assertion
// is about a role or about a component the library dresses, and when the
// baseline briefly went missing, all of them stayed green while every plain
// button in the product came back wearing native chrome.
//
// The elements below are the ones the product actually renders bare; what
// the browser computes for each of them is recorded in full. Anything that
// changes these has changed how every screen looks, which is worth a red
// test rather than a bug report from a reader.
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
      <fieldset>
        <legend>legend</legend>
      </fieldset>
      <pre>pre</pre>
      <figure>fig</figure>
      <form>
        <label>label</label>
      </form>
      <svg viewBox="0 0 8 8" />
      <img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
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
