import { SHELL_STYLE_ATTRIBUTE } from '@qualy/brand/boot'

// The shell's stylesheet, applied before the application draws.
//
// The built shell only preloads it (qualyShellStyle, @qualy/web-build): the
// first frame is styled inline and must not wait for it. Everything after
// that frame does need it, so the sheet goes in where the build left its
// link - the same place in the cascade the link had - and the render waits
// for it to load. It is almost always here already, fetched beside the
// scripts. Under the dev server the styles come with the modules and there
// is nothing to wait for.

/** resolves once the shell's stylesheet applies, or once it has failed to */
export const shellStyled = (): Promise<void> => {
  const preload = document.querySelector<HTMLLinkElement>(`link[${SHELL_STYLE_ATTRIBUTE}]`)
  if (preload === null) return Promise.resolve()
  const sheet = document.createElement('link')
  sheet.rel = 'stylesheet'
  // the preload's own request mode, or the fetched copy is not the one used
  sheet.crossOrigin = preload.crossOrigin
  sheet.href = preload.href
  const applied = new Promise<void>((resolve) => {
    // a sheet that did not arrive leaves the page unstyled, as a blocking
    // link that failed did; it does not leave it undrawn
    sheet.addEventListener('load', () => resolve(), { once: true })
    sheet.addEventListener('error', () => resolve(), { once: true })
  })
  preload.after(sheet)
  return applied
}
