import { afterEach, expect, it } from 'vitest'
import { SHELL_STYLE_ATTRIBUTE } from '@qualy/brand/boot'
import { shellStyled } from '../src/shell-style.ts'

// The built shell preloads its stylesheet rather than linking it, so the
// first frame does not wait for it; the entry applies it where the link was,
// and draws once it has.

const added: Element[] = []
afterEach(() => {
  for (const element of added.splice(0)) element.remove()
})

const preloadOf = (href: string) => {
  const preload = document.createElement('link')
  preload.rel = 'preload'
  preload.as = 'style'
  preload.crossOrigin = 'anonymous'
  preload.href = href
  preload.setAttribute(SHELL_STYLE_ATTRIBUTE, '')
  document.head.append(preload)
  added.push(preload)
  return preload
}

it('has nothing to wait for without the preload, as under the dev server', async () => {
  const before = document.querySelectorAll('link[rel="stylesheet"]').length
  await shellStyled()
  expect(document.querySelectorAll('link[rel="stylesheet"]').length).toBe(before)
})

it('applies the sheet where the build left its link, before it resolves', async () => {
  const probe = document.createElement('div')
  probe.className = 'shell-style-probe'
  document.body.append(probe)
  added.push(probe)
  const preload = preloadOf('data:text/css,.shell-style-probe{min-width:7px}')

  await shellStyled()

  const sheet = preload.nextElementSibling as HTMLLinkElement
  added.push(sheet)
  expect(sheet.rel).toBe('stylesheet')
  expect(sheet.href).toBe(preload.href)
  // the preload's request mode, or the copy it fetched is not the one used
  expect(sheet.crossOrigin).toBe('anonymous')
  expect(getComputedStyle(probe).minWidth).toBe('7px')
})

it('still lets the page draw when the sheet does not arrive', async () => {
  const preload = preloadOf('http://127.0.0.1:1/missing.css')
  await shellStyled()
  added.push(preload.nextElementSibling!)
})
